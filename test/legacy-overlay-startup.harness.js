const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const projectRoot = path.join(__dirname, '..')
const overlaySource = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'js', 'scripts', 'overlay.js'), 'utf8')
const overlayMarkup = fs.readFileSync(path.join(projectRoot, 'app', 'overlay.ejs'), 'utf8')
const uiBinderSource = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'js', 'scripts', 'uibinder.js'), 'utf8')
const uiCoreSource = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'js', 'scripts', 'uicore.js'), 'utf8')
const preloaderSource = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'js', 'preloader.js'), 'utf8')
const indexSource = fs.readFileSync(path.join(projectRoot, 'index.js'), 'utf8')
const appMarkup = fs.readFileSync(path.join(projectRoot, 'app', 'app.ejs'), 'utf8')
const frameMarkup = fs.readFileSync(path.join(projectRoot, 'app', 'frame.ejs'), 'utf8')
const landingMarkup = fs.readFileSync(path.join(projectRoot, 'app', 'landing.ejs'), 'utf8')
const landingSource = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'js', 'scripts', 'landing.js'), 'utf8')
const launcherStyles = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'css', 'launcher.css'), 'utf8')
const squadArcadeSource = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'js', 'scripts', 'squad-arcade.js'), 'utf8')
const squadArcadeStyles = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'css', 'squad-arcade.css'), 'utf8')
const configSource = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'js', 'configmanager.js'), 'utf8')
const localeSource = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'lang', 'en_US.toml'), 'utf8')
const distroDocs = fs.readFileSync(path.join(projectRoot, 'docs', 'distro.md'), 'utf8')
const sampleDistribution = fs.readFileSync(path.join(projectRoot, 'docs', 'sample_distribution.json'), 'utf8')
const readmeSource = fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8')
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'legacy-characterization.json'), 'utf8'))

function extractFunction(source, name){
    const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source)
    assert.ok(match, `missing function ${name}`)
    const bodyStart = source.indexOf('{', match.index)
    let depth = 0
    let quote = null
    let escaped = false
    let lineComment = false
    let blockComment = false
    for(let index = bodyStart; index < source.length; index++){
        const char = source[index]
        const next = source[index + 1]
        if(lineComment){ if(char === '\n') lineComment = false; continue }
        if(blockComment){ if(char === '*' && next === '/'){ blockComment = false; index++ } continue }
        if(quote != null){
            if(escaped) escaped = false
            else if(char === '\\') escaped = true
            else if(char === quote) quote = null
        } else if(char === '/' && next === '/'){
            lineComment = true
            index++
        } else if(char === '/' && next === '*'){
            blockComment = true
            index++
        } else if(char === '\'' || char === '"' || char === '`') quote = char
        else if(char === '{') depth++
        else if(char === '}' && --depth === 0) return source.slice(match.index, index + 1)
    }
    assert.fail(`unterminated function ${name}`)
}

function loadFunctions(source, names, context = {}, prelude = ''){
    const sandbox = vm.createContext({ console, ...context })
    vm.runInContext(`${prelude}\n${names.map(name => extractFunction(source, name)).join('\n')}\nglobalThis.__sut = { ${names.join(', ')} }`, sandbox)
    return { context: sandbox, ...sandbox.__sut }
}

class FakeElement {
    constructor(id = ''){
        this.id = id
        this.attributes = new Map()
        this.style = {}
        this.innerHTML = ''
        this.onclick = null
        this.clicks = 0
        this.focusCalls = 0
        this.classes = new Map()
    }
    setAttribute(name, value){ this.attributes.set(name, String(value)) }
    removeAttribute(name){ this.attributes.delete(name) }
    hasAttribute(name){ return this.attributes.has(name) }
    click(){ this.clicks++; this.onclick?.({ target: this }) }
    focus(){ this.focusCalls++ }
    getElementsByClassName(name){ return this.classes.get(name) || [] }
}

let scenarios = 0
async function scenario(name, test){
    await test()
    scenarios++
    console.log(`PASS ${name}`)
}

function knownGap(id){
    const gap = manifest.knownGaps.find(item => item.id === id)
    assert.ok(gap, `missing known gap fixture ${id}`)
    return gap
}

function createOverlayHarness(){
    const ids = Object.fromEntries([
        'main', 'overlayContainer', 'overlayContent', 'overlayTitle', 'overlayDesc',
        'overlayAcknowledge', 'overlayDismiss', 'settingsContainer'
    ].map(id => [id, new FakeElement(id)]))
    ids.overlayContent.classes.set('overlayKeybindEnter', [ids.overlayAcknowledge])
    ids.overlayContent.classes.set('overlayKeybindEsc', [ids.overlayDismiss])
    const listeners = new Map()
    const serverPreparation = []
    const jqueryState = { mainTabindex: null, dismissVisible: false }
    const document = {
        getElementById: id => ids[id],
        addEventListener(type, listener){ listeners.set(type, listener) },
        removeEventListener(type, listener){ if(listeners.get(type) === listener) listeners.delete(type) }
    }
    const $ = selector => ({
        attr(name, value){ if(selector === '#main *' && name === 'tabindex') jqueryState.mainTabindex = value; return this },
        removeAttr(name){ if(selector === '#main *' && name === 'tabindex') jqueryState.mainTabindex = null; return this },
        parent(){ return this }, children(){ return this }, hide(){ if(selector === '#overlayDismiss') jqueryState.dismissVisible = false; return this },
        show(){ if(selector === '#overlayDismiss') jqueryState.dismissVisible = true; return this },
        fadeIn(options){ options?.start?.(); return this },
        fadeOut(options){ options?.start?.(); options?.complete?.(); return this }
    })
    const sut = loadFunctions(overlaySource, [
        'overlayKeyHandler', 'overlayKeyDismissableHandler', 'bindOverlayKeys', 'toggleOverlay',
        'toggleServerSelection', 'setOverlayContent', 'setOverlayHandler', 'setDismissHandler'
    ], {
        $, document,
        Lang: { queryJS: () => 'Dismiss' },
        prepareServerSelectionList: async () => { serverPreparation.push('prepare') },
        getCurrentView: () => 'landing',
        VIEWS: { settings: 'settings' }
    }, 'let overlayHandlerContent')
    return { ids, jqueryState, listeners, serverPreparation, sut }
}

async function testOverlayContract(){
    const overlay = createOverlayHarness()
    let acknowledged = 0
    let dismissed = 0
    overlay.sut.setOverlayContent('Title', 'Description', 'Continue', 'Cancel')
    overlay.sut.setOverlayHandler(() => { acknowledged++ })
    overlay.sut.setDismissHandler(() => { dismissed++ })
    overlay.sut.toggleOverlay(true, true)
    assert.equal(overlay.ids.main.hasAttribute('overlay'), true)
    assert.equal(overlay.jqueryState.mainTabindex, '-1')
    assert.equal(overlay.jqueryState.dismissVisible, true)
    overlay.listeners.get('keydown')({ key: 'Enter' })
    overlay.listeners.get('keydown')({ key: 'Escape' })
    assert.equal(acknowledged, 1)
    assert.equal(dismissed, 1)

    overlay.sut.toggleOverlay(true, false)
    assert.equal(overlay.jqueryState.dismissVisible, false)
    overlay.listeners.get('keydown')({ key: 'Escape' })
    assert.equal(acknowledged, 2, 'Escape acknowledges a non-dismissable overlay')
    assert.equal(dismissed, 1)
    overlay.sut.toggleOverlay(false)
    assert.equal(overlay.ids.main.hasAttribute('overlay'), false)
    assert.equal(overlay.jqueryState.mainTabindex, null)
    assert.equal(overlay.listeners.has('keydown'), false)

    overlay.sut.setOverlayHandler(null)
    overlay.sut.toggleOverlay(true)
    overlay.ids.overlayAcknowledge.click()
    assert.equal(overlay.ids.main.hasAttribute('overlay'), false, 'default acknowledge closes the overlay')

    await overlay.sut.toggleServerSelection(true)
    assert.deepEqual(overlay.serverPreparation, ['prepare'])
    assert.equal(overlay.ids.main.hasAttribute('overlay'), true, 'shared server selection still opens the overlay')
    assert.equal(overlay.jqueryState.dismissVisible, true)
}

function testOverlayMarkupAndFocusContract(){
    assert.match(overlayMarkup, /id="overlayAcknowledge" class="overlayKeybindEnter"/)
    assert.match(overlayMarkup, /id="overlayDismiss"[^>]*class="overlayKeybindEsc"/)
    assert.doesNotMatch(overlayMarkup, /id="overlay(?:Acknowledge|Dismiss)"[^>]*tabindex=/, 'overlay controls use native button focusability')
    assert.match(overlaySource, /\$\('#main \*'\)\.attr\('tabindex', '-1'\)/)
    assert.match(overlaySource, /\$\('#main \*'\)\.removeAttr\('tabindex'\)/)
    assert.doesNotMatch(overlaySource.slice(0, overlaySource.indexOf('/* Server Select View */')), /\.focus\(/, 'legacy overlay does not move focus on open')
}

function createStartupFunctionHarness({ showIntro = true, introAvailable = true, fatal = false } = {}){
    const elements = Object.fromEntries(['main', 'welcome', 'startupSurface'].map(id => [id, new FakeElement(id)]))
    elements.startupSurface.setAttribute('aria-busy', 'true')
    const calls = []
    const window = {
        createSquadArcadeIntro: introAvailable ? () => ({ start: () => calls.push('intro.start') }) : undefined
    }
    const sut = loadFunctions(uiBinderSource, ['hideStartupSurface', 'showIntroForStartup'], {
        ConfigManager: { getShowIntro: () => showIntro },
        VIEWS: { welcome: '#welcome' },
        document: {
            getElementById: id => elements[id],
            querySelector: selector => selector === '#welcome' ? elements.welcome : null
        },
        window
    }, `let introStarted = false; let fatalStartupError = ${fatal}; let currentView`)
    return { calls, elements, sut, window }
}

function testIntroStartupStates(){
    const enabled = createStartupFunctionHarness()
    assert.equal(enabled.sut.showIntroForStartup(), true)
    assert.equal(enabled.sut.showIntroForStartup(), false, 'intro starts once')
    assert.deepEqual(enabled.calls, ['intro.start'])
    assert.equal(enabled.elements.main.style.display, 'block')
    assert.equal(enabled.elements.startupSurface.hidden, true)
    assert.equal(enabled.elements.startupSurface.attributes.get('aria-busy'), 'false')

    assert.equal(createStartupFunctionHarness({ showIntro: false }).sut.showIntroForStartup(), false)
    assert.equal(createStartupFunctionHarness({ introAvailable: false }).sut.showIntroForStartup(), false)
    assert.equal(createStartupFunctionHarness({ fatal: true }).sut.showIntroForStartup(), false, 'fatal state has precedence over intro')
}

async function testStartupSurfaceCompletionContract(){
    async function run(fatal){
        const calls = []
        const elements = {
            frameBar: new FakeElement('frameBar'),
            startupSurface: new FakeElement('startupSurface')
        }
        elements.startupSurface.setAttribute('aria-busy', 'true')
        const document = {
            body: { style: {}, getAttribute: () => 'fixture' },
            getElementById: id => elements[id]
        }
        const $ = selector => ({
            show(){ calls.push(['show', selector]); return this },
            fadeIn(duration){ calls.push(['fadeIn', selector, duration]); return this },
            fadeOut(duration, done){ calls.push(['fadeOut', selector, duration]); done?.(); return this }
        })
        const sut = loadFunctions(uiBinderSource, ['hideStartupSurface', 'showMainUI'], {
            isDev: true,
            loggerAutoUpdater: { info(){} },
            ipcRenderer: { send(){ throw new Error('unexpected updater IPC in dev mode') } },
            ConfigManager: {
                getSelectedServer: () => 'server',
                getAuthAccounts: () => ({}),
                getSelectedAccount: () => null
            },
            prepareSettings: async () => calls.push(['settings']),
            updateSelectedServer: () => calls.push(['server']),
            refreshServerStatus: () => calls.push(['status']),
            validateSelectedAccount(){}, prepareLoginOptionsForStartup(){},
            getStartupView: () => '#landingContainer',
            VIEWS: { loginOptions: '#loginOptionsContainer' },
            document, $, window: { squadArcadeIntro: null },
            setTimeout(listener, delay){ calls.push(['timeout', delay]); listener() }
        }, `let fatalStartupError = ${fatal}`)
        await sut.showMainUI({ getServerById: () => ({}) })
        return { calls, elements }
    }

    const completed = await run(false)
    assert.equal(completed.calls.some(call => call[0] === 'fadeIn' && call[1] === '#landingContainer' && call[2] === 1000), true)
    assert.equal(completed.calls.some(call => call[0] === 'fadeOut' && call[1] === '#startupSurface' && call[2] === 500), true)
    assert.equal(completed.elements.startupSurface.hidden, true)
    assert.equal(completed.elements.startupSurface.attributes.get('aria-busy'), 'false')

    const preempted = await run(true)
    assert.equal(preempted.calls.some(call => call[0] === 'fadeIn' || call[0] === 'fadeOut' || call[0] === 'show'), false, 'fatal state prevents delayed main navigation')
    assert.equal(preempted.elements.startupSurface.hidden, undefined, 'fatal renderer retains authority over surface dismissal')
    assert.equal(preempted.elements.startupSurface.attributes.get('aria-busy'), 'true')
}

function testFatalStartupContract(){
    function runFatal(introAvailable){
        const calls = []
        const elements = {
            overlayContainer: new FakeElement('overlayContainer'),
            startupSurface: new FakeElement('startupSurface')
        }
        elements.startupSurface.setAttribute('aria-busy', 'true')
        const intro = introAvailable ? { cancelForFatal: () => calls.push('cancelForFatal') } : null
        const window = { squadArcadeIntro: intro }
        const currentWindow = { close: () => calls.push('close') }
        let acknowledge
        const $ = selector => ({
            hide(){ calls.push(['hide', selector]); return this },
            fadeOut(duration, done){ calls.push(['fadeOut', selector, duration]); done(); return this }
        })
        const sut = loadFunctions(uiBinderSource, ['hideStartupSurface', 'showFatalStartupError'], {
            $, window,
            document: { getElementById: id => elements[id] },
            Lang: { queryJS: key => key },
            setOverlayContent: (...args) => calls.push(['content', ...args]),
            setOverlayHandler: handler => { acknowledge = handler },
            toggleOverlay: value => calls.push(['overlay', value]),
            remote: { getCurrentWindow: () => currentWindow },
            setTimeout: listener => listener()
        })
        sut.showFatalStartupError()
        return { acknowledge, calls, elements }
    }

    const withIntro = runFatal(true)
    assert.equal(withIntro.elements.startupSurface.hidden, true)
    assert.equal(withIntro.elements.startupSurface.attributes.get('aria-busy'), 'false')
    assert.equal(withIntro.calls.includes('cancelForFatal'), true)
    assert.deepEqual(withIntro.calls.at(-1), ['overlay', true])
    withIntro.acknowledge()
    assert.equal(withIntro.calls.at(-1), 'close')

    const withoutIntro = runFatal(false)
    assert.deepEqual(withoutIntro.calls[0], ['fadeOut', '#startupSurface', 250])
    assert.equal(withoutIntro.elements.startupSurface.hidden, true)
    assert.deepEqual(withoutIntro.calls.at(-1), ['overlay', true])
}

async function testStartupIpcDomCoordination(){
    const readyBlock = uiBinderSource.slice(uiBinderSource.indexOf('// Synchronous Listener'), uiBinderSource.indexOf('// Util for development'))
    const relayBlock = indexSource.slice(indexSource.indexOf('// Redirect distribution index event'), indexSource.indexOf('// Handle trash item.'))
    const calls = []
    const distro = { id: 'fixture' }
    async function runPipeline(data, readyState){
        const mainHandlers = new Map()
        const rendererHandlers = new Map()
        const documentHandlers = new Map()
        const pending = []
        const document = {
            readyState,
            addEventListener(type, handler){ documentHandlers.set(type, handler) }
        }
        const ipcRenderer = {
            on(channel, handler){ rendererHandlers.set(channel, handler) },
            send(channel, value){
                calls.push(['sender', channel, value])
                return mainHandlers.get(channel)({}, value)
            }
        }
        const ipcMain = { on(channel, handler){ mainHandlers.set(channel, handler) } }
        const relayEvent = {
            sender: {
                send(channel, value){
                    calls.push(['relay', channel, value])
                    const result = rendererHandlers.get(channel)({}, value)
                    pending.push(Promise.resolve(result))
                    return result
                }
            }
        }
        vm.runInNewContext(relayBlock, { ipcMain })
        vm.runInNewContext(`let rscShouldLoad = false; let fatalStartupError = false;\n${readyBlock}`, {
            document, ipcRenderer,
            DistroAPI: { getDistribution: async () => distro },
            syncModConfigurations: current => calls.push(['sync', current.id]),
            ensureJavaSettings: current => calls.push(['java', current.id]),
            showMainUI: current => calls.push(['main', current.id]),
            showFatalStartupError: () => calls.push(['fatal']),
            showIntroForStartup: () => calls.push(['intro'])
        })
        const sender = loadFunctions(preloaderSource, ['onDistroLoad'], {
            ConfigManager: {
                getSelectedServer: () => 'server',
                setSelectedServer(){}, save(){}
            },
            logger: { info(){} },
            ipcRenderer: { send: (channel, value) => mainHandlers.get(channel)(relayEvent, value) }
        })
        sender.onDistroLoad(data)
        await Promise.all(pending)
        return { document, documentHandlers }
    }

    const success = await runPipeline({ getServerById: () => ({}) }, 'loading')
    assert.deepEqual(calls, [
        ['relay', 'distributionIndexDone', true],
        ['sync', 'fixture'],
        ['java', 'fixture']
    ], 'real preloader sender and index relay reach the deferred uibinder receiver')
    success.document.readyState = 'interactive'
    await success.documentHandlers.get('readystatechange')()
    assert.deepEqual(calls.slice(-2), [['intro'], ['main', 'fixture']], 'DOM readiness completes deferred startup')

    calls.length = 0
    await runPipeline(null, 'complete')
    assert.deepEqual(calls, [
        ['relay', 'distributionIndexDone', false],
        ['fatal']
    ], 'real sender and relay deliver fatal startup to the real receiver')
}

async function testDomToIpcWithoutNewsContract(){
    const calls = []
    const elements = {
        frameBar: new FakeElement('frameBar'),
        startupSurface: new FakeElement('startupSurface')
    }
    elements.startupSurface.setAttribute('aria-busy', 'true')
    const document = {
        body: { style: {}, getAttribute: () => 'fixture' },
        getElementById: id => elements[id]
    }
    const $ = selector => ({
        show(){ calls.push(['show', selector]); return this },
        fadeIn(){ calls.push(['fadeIn', selector]); return this },
        fadeOut(_duration, done){ calls.push(['fadeOut', selector]); done?.(); return this },
        removeClass(value){ calls.push(['removeClass', selector, value]); return this },
        attr(name, value){ calls.push(['attr', selector, name, value]); return this }
    })
    const intro = { setRuntimeReady: () => calls.push(['runtimeReady']) }
    const window = { squadArcadeIntro: intro }
    const sut = loadFunctions(uiBinderSource, ['hideStartupSurface', 'showMainUI'], {
        isDev: false,
        loggerAutoUpdater: { info(){} },
        ipcRenderer: { send: (...args) => calls.push(['ipc', ...args]) },
        ConfigManager: {
            getAllowPrerelease: () => true, getSelectedServer: () => 'server',
            getAuthAccounts: () => ({}), getSelectedAccount: () => null
        },
        prepareSettings: async () => calls.push(['settings']),
        updateSelectedServer: () => calls.push(['server']),
        refreshServerStatus: () => calls.push(['status']),
        validateSelectedAccount(){}, prepareLoginOptionsForStartup(){},
        getStartupView: () => '#loginOptionsContainer',
        VIEWS: { loginOptions: '#loginOptionsContainer' },
        document, $, window,
        setTimeout: listener => listener()
    }, 'let fatalStartupError = false')
    await sut.showMainUI({ getServerById: () => ({}) })
    await Promise.resolve()
    assert.deepEqual(calls[0], ['ipc', 'autoUpdateAction', 'initAutoUpdater', true], 'DOM startup sends updater IPC')
    assert.equal(calls.some(call => call[0] === 'runtimeReady'), true)
    assert.doesNotMatch(uiBinderSource, /initNews|newsContainer/i, 'startup and refresh have no News call site')
    assert.doesNotMatch(landingMarkup, /id="(?:upper|lower|launch_button|image_seal_container|updateAvailableTooltip)"/, 'final legacy shell is retired')
    assert.match(appMarkup, /id="startupSurface"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-busy="true"/)

    const newsRuntimeSymbols = /\b(?:initNews|loadNews|reloadNews|displayArticle|showNewsAlert|setNewsLoading|newsActive|newsGlideCount|newsLoadingListener|newsArr|newsAlertShown)\b/
    assert.doesNotMatch(landingSource, newsRuntimeSymbols, 'News runtime symbols are retired')
    assert.doesNotMatch(landingSource, /\$\.ajax|rawDistribution\.rss|addEventListener\(['"]keydown|newsCache/i, 'News AJAX, RSS, keyboard, and cache effects are retired')
    assert.doesNotMatch(landingMarkup, /id="[^"]*news|class="[^"]*news/i, 'News markup is retired')
    assert.doesNotMatch(launcherStyles, /[#.]news|bbCodeSpoiler/i, 'legacy News selectors are retired')
    assert.doesNotMatch(squadArcadeStyles, /newsContainer/i, 'Home CSS has no News dependency')
    assert.doesNotMatch(squadArcadeSource, /newsContainer/i, 'Home initializes without News markup')
    assert.doesNotMatch(squadArcadeSource, /legacyLanding|setLegacyHidden|launch_button|\bupper\b|\blower\b/, 'Home has no final shell guard or launch fallback')
    assert.doesNotMatch(configSource, /newsCache|getNewsCache|setNewsCache|setNewsCacheDismissed/i, 'News cache schema and APIs are retired')
    assert.doesNotMatch(localeSource, /news/i, 'exclusive News locale keys are retired')
    assert.doesNotMatch(distroDocs, /DistroIndex\.rss|loading news|"rss"/i, 'RSS News documentation is retired')
    assert.doesNotMatch(sampleDistribution, /"rss"\s*:/i, 'sample distribution no longer advertises RSS News')
    assert.doesNotMatch(readmeSource, /^\s*[*-]\s+.*\b(?:News|RSS) feed\b.*$/gim, 'README no longer advertises a News or RSS feed capability')
    assert.doesNotMatch(readmeSource, /^\s*[*-]\s+.*(?:\bstatus\b.*\bMojang\b|\bMojang\b.*\bstatus\b).*$/gim, 'README no longer advertises a Mojang service-status capability')
    assert.equal(fs.existsSync(path.join(projectRoot, 'app', 'assets', 'images', 'icons', 'news.svg')), false, 'exclusive News asset is retired')
    assert.equal(manifest.knownGaps.some(item => item.id === 'hidden-news-effects'), false, 'resolved News gap is removed')
}

function testWindowControlContract(){
    class WindowControl {
        constructor(){
            this.listeners = new Map()
        }
        addEventListener(type, listener){ this.listeners.set(type, listener) }
        click(){ this.listeners.get('click')?.({ target: this }) }
    }

    const controls = {
        fCb: [new WindowControl(), new WindowControl()],
        fRb: [new WindowControl(), new WindowControl()],
        fMb: [new WindowControl(), new WindowControl()]
    }
    const documentListeners = new Map()
    const calls = []
    let maximized = false
    const currentWindow = {
        close(){ calls.push('close') },
        isMaximized(){ calls.push('isMaximized'); return maximized },
        maximize(){ calls.push('maximize'); maximized = true },
        unmaximize(){ calls.push('unmaximize'); maximized = false },
        minimize(){ calls.push('minimize') },
        toggleDevTools(){ calls.push('toggleDevTools') }
    }
    const document = {
        readyState: 'loading',
        activeElement: { blur(){ calls.push('blur') } },
        addEventListener(type, listener){ documentListeners.set(type, listener) },
        getElementsByClassName(name){ return controls[name] || [] },
        getElementById(){ return null },
        querySelector(){ return null }
    }
    const jquery = () => ({ on(){} })
    const sandbox = {
        console,
        document,
        window: {},
        global: {},
        process: { platform: 'win32', arch: 'x64' },
        require(id){
            if(id === 'jquery') return jquery
            if(id === 'electron') return {
                ipcRenderer: { on(){}, send(){} },
                shell: { openExternal(){} },
                webFrame: { setZoomLevel(){}, setVisualZoomLevelLimits(){} }
            }
            if(id === '@electron/remote') return {
                getCurrentWindow: () => currentWindow,
                getCurrentWebContents: () => ({ on(){} })
            }
            if(id === './assets/js/isdev') return true
            if(id === 'helios-core') return { LoggerUtil: { getLogger: () => ({ info(){}, error(){}, debug(){} }) } }
            if(id === './assets/js/langloader') return { queryJS: key => key }
            throw new Error(`Unexpected module: ${id}`)
        }
    }
    vm.runInContext(uiCoreSource, vm.createContext(sandbox))

    document.readyState = 'interactive'
    documentListeners.get('readystatechange')()
    controls.fCb[0].click()
    controls.fRb[0].click()
    controls.fRb[1].click()
    controls.fMb[0].click()
    assert.deepEqual(calls, [
        'close',
        'isMaximized', 'maximize', 'blur',
        'isMaximized', 'unmaximize', 'blur',
        'minimize', 'blur'
    ], 'real uicore handlers preserve close, maximize, restore, and minimize behavior')

    assert.match(appMarkup, /<%-\s*include\(['"]frame['"]\)\s*%>/, 'the application retains the authoritative frame include')
    for(const [id, className] of [
        ['frameButtonDarwin_close', 'fCb'],
        ['frameButtonDarwin_minimize', 'fMb'],
        ['frameButtonDarwin_restoredown', 'fRb'],
        ['frameButton_close', 'fCb'],
        ['frameButton_minimize', 'fMb'],
        ['frameButton_restoredown', 'fRb']
    ]){
        assert.match(frameMarkup, new RegExp(`<button[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*id="${id}"`), `${id} remains in the authoritative frame DOM`)
    }
    assert.doesNotMatch(landingMarkup, /id="(?:upper|lower)"/, 'legacy upper and lower remain retired')
}

async function run(){
    await scenario('overlay acknowledge, dismiss, keyboard, dismissability, and tabindex remain stable', testOverlayContract)
    await scenario('overlay markup preserves native focusability without focus transfer', testOverlayMarkupAndFocusContract)
    await scenario('startup intro on, off, unavailable, and fatal precedence remain stable', testIntroStartupStates)
    await scenario('native startup surface completes without late fatal navigation', testStartupSurfaceCompletionContract)
    await scenario('fatal startup cancels intro, renders overlay, and closes the window', testFatalStartupContract)
    await scenario('preloader sender, index relay, and uibinder receiver defer to DOM readiness with fatal precedence', testStartupIpcDomCoordination)
    await scenario('DOM startup sends IPC with News fully retired', testDomToIpcWithoutNewsContract)
    await scenario('window controls execute close, maximize, restore, and minimize with authoritative frame DOM intact', testWindowControlContract)
    console.log(`Legacy overlay/startup harness: ${scenarios} scenarios passed`)
}

run().catch(error => {
    console.error(error)
    process.exitCode = 1
})

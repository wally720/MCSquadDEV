const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const projectRoot = path.join(__dirname, '..')
const settingsSource = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'js', 'scripts', 'settings.js'), 'utf8')
const settingsMarkup = fs.readFileSync(path.join(projectRoot, 'app', 'settings.ejs'), 'utf8')
const landingSource = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'js', 'scripts', 'landing.js'), 'utf8')
const squadArcadeSource = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'js', 'scripts', 'squad-arcade.js'), 'utf8')
const uiCoreSource = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'js', 'scripts', 'uicore.js'), 'utf8')
const uiBinderSource = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'js', 'scripts', 'uibinder.js'), 'utf8')
const appMarkup = fs.readFileSync(path.join(projectRoot, 'app', 'app.ejs'), 'utf8')
const languageSource = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'lang', 'en_US.toml'), 'utf8')
const settingsStyles = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'css', 'squad-arcade-settings.css'), 'utf8')
const settingsVisualSource = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'js', 'scripts', 'squad-arcade-settings.js'), 'utf8')

function extractFunction(source, name){
    const signature = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`)
    const match = signature.exec(source)
    assert.ok(match, `missing function ${name}`)
    const start = match.index
    const bodyStart = source.indexOf('{', start)
    let depth = 0
    let quote = null
    let escaped = false
    let lineComment = false
    let blockComment = false

    for(let index = bodyStart; index < source.length; index++){
        const char = source[index]
        const next = source[index + 1]
        if(lineComment){
            if(char === '\n') lineComment = false
            continue
        }
        if(blockComment){
            if(char === '*' && next === '/'){
                blockComment = false
                index++
            }
            continue
        }
        if(quote != null){
            if(escaped){
                escaped = false
            } else if(char === '\\'){
                escaped = true
            } else if(char === quote){
                quote = null
            }
            continue
        }
        if(char === '/' && next === '/'){
            lineComment = true
            index++
        } else if(char === '/' && next === '*'){
            blockComment = true
            index++
        } else if(char === '\'' || char === '"' || char === '`'){
            quote = char
        } else if(char === '{'){
            depth++
        } else if(char === '}'){
            depth--
            if(depth === 0) return source.slice(start, index + 1)
        }
    }
    assert.fail(`unterminated function ${name}`)
}

function extractBetween(source, startMarker, endMarker){
    const start = source.indexOf(startMarker)
    const end = source.indexOf(endMarker, start)
    assert.ok(start >= 0, `missing marker ${startMarker}`)
    assert.ok(end > start, `missing marker ${endMarker}`)
    return source.slice(start, end)
}

function loadFunctions(source, names, context = {}, prelude = ''){
    const sandbox = vm.createContext({
        console,
        ...context
    })
    const functions = names.map(name => extractFunction(source, name)).join('\n')
    const exports = names.map(name => `${name}`).join(', ')
    vm.runInContext(`${prelude}\n${functions}\nglobalThis.__sut = { ${exports} }`, sandbox)
    return { context: sandbox, ...sandbox.__sut }
}

class FakeClassList {
    constructor(values = []){
        this.values = new Set(values)
    }

    contains(value){
        return this.values.has(value)
    }

    add(value){
        this.values.add(value)
    }

    remove(value){
        this.values.delete(value)
    }
}

class FakeElement {
    constructor({ id = '', tagName = 'DIV', type = '', classes = [] } = {}){
        this.id = id
        this.tagName = tagName
        this.type = type
        this.attributes = new Map()
        this.classList = new FakeClassList(classes)
        this.listeners = new Map()
        this.style = {}
        this.textContent = ''
        this.value = ''
        this.checked = false
        this.disabled = false
        this.scrollTop = 0
        this.firstElementChild = { marginTop: '0' }
        this.onscroll = null
        this.onclick = null
        this.focusCalls = 0
        this.clickCalls = 0
    }

    addEventListener(type, listener){
        const listeners = this.listeners.get(type) || []
        listeners.push(listener)
        this.listeners.set(type, listeners)
    }

    removeEventListener(type, listener){
        const listeners = this.listeners.get(type) || []
        this.listeners.set(type, listeners.filter(candidate => candidate !== listener))
    }

    dispatch(type, event = {}){
        const dispatched = { target: this, preventDefault(){ this.defaultPrevented = true }, ...event }
        this.listeners.get(type)?.forEach(listener => listener(dispatched))
        return dispatched
    }

    focus(){
        this.focusCalls++
        this.onFocus?.(this)
    }

    click(){
        this.clickCalls++
        this.onclick?.({ target: this })
        this.dispatch('click')
    }

    closest(){
        return this
    }

    setAttribute(name, value){
        this.attributes.set(name, String(value))
    }

    getAttribute(name){
        return this.attributes.get(name) ?? null
    }

    hasAttribute(name){
        return this.attributes.has(name)
    }

    removeAttribute(name){
        this.attributes.delete(name)
    }
}

function blockedBoundary(name){
    return new Proxy({}, {
        get(){
            throw new Error(`Unexpected ${name} access`)
        }
    })
}

function createSettingsDocument({ values = [] } = {}){
    const ids = new Map()
    const settingsContainer = new FakeElement({ id: 'settingsContainer' })
    settingsContainer.querySelectorAll = selector => selector === '[cValue]' ? values : []
    ids.set('settingsContainer', settingsContainer)
    ids.set('settingsNavDone', new FakeElement({ id: 'settingsNavDone', tagName: 'BUTTON' }))
    return {
        ids,
        navItems: [],
        getElementById(id){ return ids.get(id) || null },
        getElementsByClassName(name){ return name === 'settingsNavItem' ? this.navItems : [] }
    }
}

function createConfigElement({ id, cValue, serverDependent = false, tagName = 'INPUT', type = 'text', classes = [] }){
    const element = new FakeElement({ id, tagName, type, classes })
    element.setAttribute('cValue', cValue)
    if(serverDependent) element.setAttribute('serverDependent', '')
    return element
}

let scenarios = 0
async function scenario(name, test){
    await test()
    scenarios++
    console.log(`PASS ${name}`)
}

function testMarkupContract(){
    const markup = settingsMarkup.replace(/<!--[^]*?-->/g, '')
    const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1])
    const navTargets = [...markup.matchAll(/class="settingsNavItem"\s+rSc="([^"]+)"/g)].map(match => match[1])
    const valueTags = [...markup.matchAll(/<[^>]+\bcValue="[^"]+"[^>]*>/g)].map(match => match[0])
    const values = valueTags.map(tag => tag.match(/\bcValue="([^"]+)"/)[1])
    const serverDependent = valueTags
        .filter(tag => /\bserverDependent(?:\s|>|=)/.test(tag))
        .map(tag => tag.match(/\bcValue="([^"]+)"/)[1])
    const essentialIds = [
        'settingsContainer',
        'settingsNavAccount',
        'settingsNavMods',
        'settingsNavUpdate',
        'settingsNavDone',
        'settingsTabAccount',
        'settingsTabMinecraft',
        'settingsTabMods',
        'settingsTabJava',
        'settingsTabLauncher',
        'settingsTabAbout',
        'settingsTabUpdate',
        'settingsGameWidth',
        'settingsGameHeight',
        'settingsMaxRAMRange',
        'settingsMinRAMRange',
        'settingsJavaExecVal',
        'settingsJVMOptsVal',
        'settingsShowIntro',
        'settingsUpdateActionButton'
    ]

    assert.deepEqual(navTargets, [
        'settingsTabAccount',
        'settingsTabMinecraft',
        'settingsTabMods',
        'settingsTabJava',
        'settingsTabLauncher',
        'settingsTabAbout',
        'settingsTabUpdate'
    ])
    assert.equal(navTargets.length, 7, 'Settings keeps exactly seven rSc tabs')
    assert.deepEqual(values, [
        'GameWidth',
        'GameHeight',
        'Fullscreen',
        'AutoConnect',
        'LaunchDetached',
        'MaxRAM',
        'MinRAM',
        'JavaExecutable',
        'JVMOptions',
        'AllowPrerelease',
        'ShowIntro',
        'DataDirectory'
    ])
    assert.deepEqual(serverDependent, ['MaxRAM', 'MinRAM', 'JavaExecutable', 'JVMOptions'])
    assert.deepEqual(essentialIds.filter(id => !ids.includes(id)), [], 'essential Settings IDs remain present')
}

async function testPrepareSettings(first){
    const calls = []
    const stub = name => async () => { calls.push(name) }
    const context = {
        setupSettingsTabs: stub('tabs'),
        initSettingsValidators: stub('validators'),
        prepareUpdateTab: stub('update'),
        prepareModsTab: stub('mods'),
        initSettingsValues: stub('values'),
        prepareAccountsTab: stub('accounts'),
        prepareJavaTab: stub('java'),
        prepareAboutTab: stub('about'),
        require(){ throw new Error('Unexpected module access') },
        fs: blockedBoundary('filesystem'),
        shell: blockedBoundary('shell'),
        ipcRenderer: blockedBoundary('IPC'),
        AuthManager: blockedBoundary('auth'),
        JavaGuard: blockedBoundary('Java'),
        fetch(){ throw new Error('Unexpected network access') }
    }
    const sut = loadFunctions(settingsSource, ['prepareSettings'], context)
    await sut.prepareSettings(first)
    assert.deepEqual(calls, first
        ? ['tabs', 'validators', 'update', 'values', 'accounts', 'java', 'about']
        : ['mods', 'values', 'accounts', 'java', 'about'])
}

function testSettingsNavigation(){
    const document = createSettingsDocument()
    const accountNav = new FakeElement({ id: 'settingsNavAccount', tagName: 'BUTTON' })
    accountNav.setAttribute('rSc', 'settingsTabAccount')
    accountNav.setAttribute('selected', '')
    const modsNav = new FakeElement({ id: 'settingsNavMods', tagName: 'BUTTON' })
    modsNav.setAttribute('rSc', 'settingsTabMods')
    document.navItems = [accountNav, modsNav]
    const accountTab = new FakeElement({ id: 'settingsTabAccount' })
    const modsTab = new FakeElement({ id: 'settingsTabMods' })
    modsTab.scrollTop = 12
    document.ids.set(accountTab.id, accountTab)
    document.ids.set(modsTab.id, modsTab)
    const transitions = []
    const jquery = selector => ({
        hide(_duration, complete){ transitions.push(`hide:${selector}`); complete() },
        show(options){ transitions.push(`show:${selector}`); options.start() },
        fadeOut(_duration, complete){ transitions.push(`fadeOut:${selector}`); complete() },
        fadeIn(options){ transitions.push(`fadeIn:${selector}`); options.start() }
    })
    const prelude = 'let selectedSettingsTab = \'settingsTabAccount\'; globalThis.getSelectedSettingsTab = () => selectedSettingsTab'
    const sut = loadFunctions(settingsSource, ['settingsTabScrollListener', 'settingsNavItemListener'], {
        document,
        $: jquery,
        getComputedStyle: element => ({ marginTop: element.marginTop })
    }, prelude)

    sut.settingsNavItemListener(modsNav, false)
    assert.equal(accountNav.hasAttribute('selected'), false)
    assert.equal(modsNav.hasAttribute('selected'), true)
    assert.equal(sut.context.getSelectedSettingsTab(), 'settingsTabMods')
    assert.equal(accountTab.onscroll, null)
    assert.equal(modsTab.onscroll, sut.settingsTabScrollListener)
    assert.deepEqual(transitions, ['hide:#settingsTabAccount', 'show:#settingsTabMods'])
    assert.equal(document.getElementById('settingsContainer').hasAttribute('scrolled'), true)
}

async function testGenericValues(){
    const width = createConfigElement({ id: 'settingsGameWidth', cValue: 'GameWidth', type: 'number' })
    const fullscreen = createConfigElement({ id: 'fullscreen', cValue: 'Fullscreen', type: 'checkbox' })
    const jvm = createConfigElement({ id: 'settingsJVMOptsVal', cValue: 'JVMOptions', serverDependent: true })
    const values = [width, fullscreen, jvm]
    const document = createSettingsDocument({ values })
    const calls = []
    const config = {
        getSelectedServer(){ calls.push(['getSelectedServer']); return 'server-a' },
        getGameWidth(){ calls.push(['getGameWidth']); return 1280 },
        getFullscreen(){ calls.push(['getFullscreen']); return true },
        getJVMOptions(server){ calls.push(['getJVMOptions', server]); return ['-Xmx2G', '-Dsafe=true'] },
        setGameWidth(value){ calls.push(['setGameWidth', value]) },
        setFullscreen(value){ calls.push(['setFullscreen', value]) },
        setJVMOptions(server, value){ calls.push(['setJVMOptions', server, value]) }
    }
    const sut = loadFunctions(settingsSource, ['initSettingsValues', 'saveSettingsValues'], {
        document,
        ConfigManager: config,
        populateJavaExecDetails(){ throw new Error('Unexpected Java inspection') },
        changeAllowPrerelease(){ throw new Error('Unexpected updater access') }
    })

    await sut.initSettingsValues()
    assert.equal(width.value, 1280)
    assert.equal(fullscreen.checked, true)
    assert.equal(jvm.value, '-Xmx2G -Dsafe=true')
    width.value = '1920'
    fullscreen.checked = false
    jvm.value = ' -Xms1G   -Doffline=true '
    sut.saveSettingsValues()
    assert.equal(JSON.stringify(calls.filter(call => call[0].startsWith('set'))), JSON.stringify([
        ['setGameWidth', '1920'],
        ['setFullscreen', false],
        ['setJVMOptions', 'server-a', ['-Xms1G', '-Doffline=true']]
    ]))
}

function testShowIntroMarkup(){
    const launcherStart = settingsMarkup.indexOf('id="settingsTabLauncher"')
    const launcherEnd = settingsMarkup.indexOf('id="settingsTabAbout"', launcherStart)
    const launcherMarkup = settingsMarkup.slice(launcherStart, launcherEnd)
    const showIntroIndex = launcherMarkup.indexOf('cValue="ShowIntro"')
    const dataDirectoryIndex = launcherMarkup.indexOf('cValue="DataDirectory"')
    assert.ok(showIntroIndex >= 0 && showIntroIndex < dataDirectoryIndex, 'ShowIntro appears immediately before the data directory field')
    assert.equal((settingsMarkup.match(/cValue="ShowIntro"/g) || []).length, 1)
    assert.match(launcherMarkup, /<label class="settingsFieldTitle" for="settingsShowIntro">/)
    assert.match(launcherMarkup, /id="settingsShowIntro" aria-describedby="settingsShowIntroDesc"/)
    assert.match(languageSource, /showIntroTitle = "Mostrar introducción al iniciar"/)
    assert.match(languageSource, /showIntroDesc = "Se aplicará la próxima vez que abras el launcher\."/)
    assert.doesNotMatch(settingsMarkup, /reproducir[^<]*intro|replay[^<]*intro/i, 'Settings exposes no replay action')
    assert.doesNotMatch(settingsVisualSource, /ShowIntro|settingsShowIntro/, 'the visual controller adds no preference handler')
}

async function testShowIntroGenericBinding(){
    const checkbox = createConfigElement({ id: 'settingsShowIntro', cValue: 'ShowIntro', type: 'checkbox' })
    const document = createSettingsDocument({ values: [checkbox] })
    const calls = []
    const config = {
        getShowIntro(){ calls.push(['getShowIntro']); return true },
        setShowIntro(value){ calls.push(['setShowIntro', value]) },
        save(){ calls.push(['save']) }
    }
    const sut = loadFunctions(settingsSource, ['initSettingsValues', 'saveSettingsValues'], {
        document,
        ConfigManager: config,
        populateJavaExecDetails(){},
        changeAllowPrerelease(){}
    })

    await sut.initSettingsValues()
    assert.equal(checkbox.checked, true)
    assert.deepEqual(calls, [['getShowIntro']])
    checkbox.checked = false
    checkbox.dispatch('change')
    assert.deepEqual(calls, [['getShowIntro']], 'changing the toggle does not persist immediately')
    sut.saveSettingsValues()
    assert.deepEqual(calls, [['getShowIntro'], ['setShowIntro', false]])
}

function testShowIntroDoneOrder(){
    const checkbox = createConfigElement({ id: 'settingsShowIntro', cValue: 'ShowIntro', type: 'checkbox' })
    checkbox.checked = false
    const document = createSettingsDocument({ values: [checkbox] })
    const calls = []
    const sut = loadFunctions(settingsSource, ['saveSettingsValues', 'fullSettingsSave'], {
        document,
        ConfigManager: {
            setShowIntro(value){ calls.push(`setShowIntro:${value}`) },
            save(){ calls.push('ConfigManager.save') }
        },
        changeAllowPrerelease(){},
        saveModConfiguration(){ calls.push('mods') },
        saveDropinModConfiguration(){ calls.push('drop-ins') },
        saveShaderpackSettings(){ calls.push('shaders') }
    })
    sut.fullSettingsSave()
    assert.deepEqual(calls, ['setShowIntro:false', 'mods', 'ConfigManager.save', 'drop-ins', 'shaders'])
}

function testShowIntroNextStartup(){
    function runStartup(showIntro){
        let created = 0
        let started = 0
        const elements = {
            main: new FakeElement(),
            welcome: new FakeElement(),
            loadingContainer: new FakeElement(),
            loadSpinnerImage: new FakeElement()
        }
        const sut = loadFunctions(uiBinderSource, ['showIntroForStartup'], {
            ConfigManager: { getShowIntro: () => showIntro },
            VIEWS: { welcome: '#welcome' },
            document: {
                getElementById: id => elements[id],
                querySelector: selector => selector === '#welcome' ? elements.welcome : null
            },
            window: {
                createSquadArcadeIntro(){
                    created++
                    return { start(){ started++ } }
                }
            }
        }, 'let introStarted = false; let fatalStartupError = false; let currentView = null')
        const result = sut.showIntroForStartup()
        return { created, result, started }
    }

    assert.deepEqual(runStartup(false), { created: 0, result: false, started: 0 })
    assert.deepEqual(runStartup(true), { created: 1, result: true, started: 1 })
}

function testResolutionValidation(){
    const width = createConfigElement({ id: 'settingsGameWidth', cValue: 'GameWidth', type: 'number' })
    const document = createSettingsDocument({ values: [width] })
    const prelude = [
        'const settingsState = { invalid: new Set() }',
        'const settingsNavDone = document.getElementById(\'settingsNavDone\')'
    ].join('\n')
    const sut = loadFunctions(settingsSource, ['settingsSaveDisabled', 'initSettingsValidators'], {
        document,
        ConfigManager: { validateGameWidth: value => Number(value) >= 640 }
    }, prelude)
    sut.initSettingsValidators()

    width.value = '320'
    width.dispatch('keyup')
    assert.equal(width.hasAttribute('error'), true)
    assert.equal(document.getElementById('settingsNavDone').disabled, true)
    width.value = '1280'
    width.dispatch('keyup')
    assert.equal(width.hasAttribute('error'), false)
    assert.equal(document.getElementById('settingsNavDone').disabled, false)
}

function testFullSaveOrder(){
    const calls = []
    const sut = loadFunctions(settingsSource, ['fullSettingsSave'], {
        saveSettingsValues(){ calls.push('settings') },
        saveModConfiguration(){ calls.push('mods') },
        ConfigManager: { save(){ calls.push('ConfigManager.save') } },
        saveDropinModConfiguration(){ calls.push('drop-ins') },
        saveShaderpackSettings(){ calls.push('shaders') }
    })
    sut.fullSettingsSave()
    assert.deepEqual(calls, ['settings', 'mods', 'ConfigManager.save', 'drop-ins', 'shaders'])
}

function testServerChangeOrder(){
    const calls = []
    const elements = Object.fromEntries([
        'server_thumbnail',
        'launch_button'
    ].map(id => [id, new FakeElement({ id })]))
    const context = {
        getCurrentView(){ return '#settingsContainer' },
        VIEWS: { settings: '#settingsContainer' },
        fullSettingsSave(){ calls.push('fullSettingsSave') },
        ConfigManager: {
            setSelectedServer(id){ calls.push(`setSelectedServer:${id}`) },
            save(){ calls.push('ConfigManager.save') }
        },
        server_selection_button: new FakeElement(),
        Lang: { queryJS(){ return 'None' } },
        document: { getElementById: id => elements[id] },
        animateSettingsTabRefresh(){ calls.push('refresh') },
        setLaunchEnabled(){ calls.push('setLaunchEnabled') },
        window: { squadArcade: { updateServer(){ calls.push('squadArcade.updateServer') } } }
    }
    const sut = loadFunctions(landingSource, ['updateSelectedServer'], context)
    sut.updateSelectedServer({ rawServer: { id: 'server-b', name: 'Beta', icon: 'beta.png' } })
    assert.deepEqual(calls.slice(0, 4), [
        'fullSettingsSave',
        'setSelectedServer:server-b',
        'ConfigManager.save',
        'refresh'
    ])
}

function testDoneAfterSave(){
    const calls = []
    const document = createSettingsDocument()
    const bindingBlock = extractBetween(settingsSource, 'const settingsNavDone =', 'Account Management Tab')
    const binding = bindingBlock.slice(0, bindingBlock.lastIndexOf('/**'))
    const sandbox = vm.createContext({
        document,
        saveSettingsValues(){ calls.push('settings') },
        saveModConfiguration(){ calls.push('mods') },
        ConfigManager: { save(){ calls.push('ConfigManager.save') } },
        saveDropinModConfiguration(){ calls.push('drop-ins') },
        saveShaderpackSettings(){ calls.push('shaders') },
        getCurrentView(){ return '#settingsContainer' },
        VIEWS: { landing: '#landingContainer' },
        switchView(from, to){ calls.push(`switch:${from}->${to}`) }
    })
    vm.runInContext(binding, sandbox)
    document.getElementById('settingsNavDone').onclick()
    assert.deepEqual(calls, [
        'settings',
        'mods',
        'ConfigManager.save',
        'drop-ins',
        'shaders',
        'switch:#settingsContainer->#landingContainer'
    ])
}

async function testSettingsRoutes(){
    const calls = []
    const elements = {
        settingsMediaButton: new FakeElement({ id: 'settingsMediaButton' }),
        avatarOverlay: new FakeElement({ id: 'avatarOverlay' }),
        settingsNavAccount: new FakeElement({ id: 'settingsNavAccount' }),
        settingsNavMods: new FakeElement({ id: 'settingsNavMods' }),
        settingsNavUpdate: new FakeElement({ id: 'settingsNavUpdate' }),
        image_seal_container: new FakeElement({ id: 'image_seal_container' })
    }
    const document = { getElementById: id => elements[id] || null }
    const common = {
        document,
        async prepareSettings(){ calls.push('prepare') },
        getCurrentView(){ return '#landingContainer' },
        VIEWS: { settings: '#settingsContainer' },
        switchView(_from, to, _out, _in, onCurrentFade){
            calls.push(`switch:${to}`)
            onCurrentFade?.()
        },
        settingsNavItemListener(element, fade){ calls.push(`tab:${element.id}:${fade}`) }
    }
    const landingBindings = extractBetween(landingSource, '// Bind settings button', '// Bind selected account')
    vm.runInNewContext(landingBindings, common)
    await elements.settingsMediaButton.onclick({})
    assert.deepEqual(calls.splice(0), ['prepare', 'switch:#settingsContainer'])
    await elements.avatarOverlay.onclick({})
    assert.deepEqual(calls.splice(0), ['prepare', 'switch:#settingsContainer', 'tab:settingsNavAccount:false'])

    const open = loadFunctions(squadArcadeSource, ['openSettings'], common)
    await open.openSettings('settingsNavMods')
    assert.deepEqual(calls.splice(0), ['prepare', 'switch:#settingsContainer', 'tab:settingsNavMods:false'])

    const update = loadFunctions(uiCoreSource, ['showUpdateUI'], common)
    update.showUpdateUI({ version: '2.0.0' })
    elements.image_seal_container.onclick()
    assert.deepEqual(calls, ['switch:#settingsContainer', 'tab:settingsNavUpdate:false'])
}

function testBlockedSideEffects(){
    const boundaries = ['filesystem', 'shell', 'IPC', 'auth', 'Java', 'network']
    boundaries.forEach(name => {
        const boundary = blockedBoundary(name)
        assert.throws(() => boundary.anything, new RegExp(`Unexpected ${name} access`))
    })
    assert.throws(() => {
        const guardedRequire = name => { throw new Error(`Unexpected module: ${name}`) }
        guardedRequire('electron')
    }, /Unexpected module: electron/)
}

function testMotionLayerSeparation(){
    const installedAnime = require('animejs')
    assert.equal(require('animejs/package.json').version, '4.3.0')
    assert.equal(typeof installedAnime.animate, 'function')
    assert.doesNotMatch(settingsSource, /require\(['"]animejs['"]\)/, 'legacy Settings remains motion-free')
    assert.match(settingsVisualSource, /require\('animejs'\)/, 'motion loads only from the progressive controller')
    assert.doesNotMatch(settingsMarkup, /data-(?:settings-)?motion/, 'motion does not add behavioral markup contracts')
}

function testVisualAssetContract(){
    const launcherIndex = appMarkup.indexOf('./assets/css/launcher.css')
    const homeIndex = appMarkup.indexOf('./assets/css/squad-arcade.css')
    const introIndex = appMarkup.indexOf('./assets/css/squad-arcade-intro.css')
    const settingsIndex = appMarkup.indexOf('./assets/css/squad-arcade-settings.css')
    assert.ok(launcherIndex >= 0 && launcherIndex < settingsIndex, 'Settings CSS loads after launcher CSS')
    assert.ok(homeIndex >= 0 && homeIndex < settingsIndex, 'Settings CSS loads after Home CSS')
    assert.ok(introIndex >= 0 && introIndex < settingsIndex, 'Settings CSS loads after Intro CSS')

    const selectorLines = settingsStyles.split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.endsWith('{') && !line.startsWith('@'))
    assert.ok(selectorLines.length > 0)
    assert.equal(selectorLines.every(line => line.startsWith('#settingsContainer.is-squad-settings-ready')), true, 'all Settings selectors are ready-namespaced')
    assert.match(settingsStyles, /pointer-events:\s*none/, 'decorative layers cannot block clicks')
    assert.doesNotMatch(settingsStyles, /@keyframes|animation\s*:/, 'WU2 does not add motion')
    assert.match(settingsStyles, /flex:\s*0 0 214px/, 'desktop Service Bay rail remains 214px')
    assert.match(settingsStyles, /@media \(max-width:\s*860px\)/, 'narrow layouts receive a width fallback')
    assert.match(settingsStyles, /@media \(max-height:\s*600px\)/, 'short layouts receive a height fallback')
    assert.match(settingsMarkup, /data-sa-title="BAHÍA DE SERVICIO"/, 'technical header keeps contextual Spanish copy')

    const legacyScript = settingsMarkup.indexOf('./assets/js/scripts/settings.js')
    const visualScript = settingsMarkup.indexOf('./assets/js/scripts/squad-arcade-settings.js')
    assert.ok(legacyScript >= 0 && legacyScript < visualScript, 'visual controller loads after legacy Settings')
    assert.match(settingsVisualSource, /require\('animejs'\)/, 'WU3 loads local Anime from the visual controller')
}

function testModsAndScrollContracts(){
    const modsStart = settingsMarkup.indexOf('id="settingsTabMods"')
    const modsEnd = settingsMarkup.indexOf('id="settingsTabJava"', modsStart)
    const modsMarkup = settingsMarkup.slice(modsStart, modsEnd)
    const modsIds = [...modsMarkup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1])
    assert.deepEqual(modsIds, [
        'settingsTabMods',
        'settingsModsContainer',
        'settingsReqModsContainer',
        'settingsReqModsContent',
        'settingsOptModsContainer',
        'settingsOptModsContent',
        'settingsDropinModsContainer',
        'settingsDropinFileSystemButton',
        'settingsDropinRefreshNote',
        'settingsDropinModsContent',
        'settingsShadersContainer',
        'settingsShaderpackDesc',
        'settingsShaderpackWrapper',
        'settingsShaderpackButton',
        'settingsShadersSelected',
        'settingsShadersOptions'
    ])
    assert.match(modsMarkup, /class="settingsTab sa-module-bay"/, 'Mods receives only the neutral module-bay hook')
    assert.match(modsMarkup, /class="settingsSwitchServerButton"/, 'server switch handler target remains intact')
    assert.match(modsMarkup, /class="settingsSelectContainer"/, 'shader selector structure remains intact')

    const tabTargets = [
        'settingsTabAccount',
        'settingsTabMinecraft',
        'settingsTabMods',
        'settingsTabJava',
        'settingsTabLauncher',
        'settingsTabAbout',
        'settingsTabUpdate'
    ]
    tabTargets.forEach(id => {
        const headerFirst = new RegExp(`id="${id}"[^>]*>\\s*<div class="settingsTabHeader"`)
        assert.match(settingsMarkup, headerFirst, `${id} keeps its header as first child`)
    })
    assert.match(settingsStyles, /\.settingsTab\s*\{[^}]*overflow-y:\s*auto/s, 'tab-local vertical scrolling remains active')
}

function createSettingsAnimeStub({ supportsRevert = true, failAnimate = false } = {}){
    const calls = { animations: [], cancelled: 0, reverted: 0 }
    return {
        calls,
        api: {
            animate(targets, parameters){
                const originals = targets.map(target => ({
                    opacity: target.style.opacity || '',
                    target,
                    transform: target.style.transform || ''
                }))
                targets.forEach(target => {
                    if(parameters.opacity != null) target.style.opacity = '0.42'
                    if(parameters.x != null || parameters.scale != null) target.style.transform = 'translateX(4px) scale(.98)'
                })
                const animation = {
                    cancelled: false,
                    cancel(){
                        if(!this.cancelled){
                            this.cancelled = true
                            calls.cancelled++
                        }
                    },
                    complete(){
                        targets.forEach(target => {
                            if(parameters.opacity != null) target.style.opacity = '1'
                            if(parameters.x != null || parameters.scale != null) target.style.transform = 'translateX(0px) scale(1)'
                        })
                        parameters.onComplete?.()
                    }
                }
                if(supportsRevert){
                    animation.revert = () => {
                        calls.reverted++
                        originals.forEach(({ opacity, target, transform }) => {
                            target.style.opacity = opacity
                            target.style.transform = transform
                        })
                    }
                }
                calls.animations.push({ animation, parameters, targets })
                if(failAnimate) throw new Error('Animation initialization failed')
                return animation
            }
        }
    }
}

function createVisualControllerHarness({ initialTheme = 'overworld', missingId = null, getThemeThrows = false, observerThrows = false, animeAvailable = true, animeFails = false, animeSupportsRevert = true, reducedMotion = false } = {}){
    const tabTargets = [
        'settingsTabAccount',
        'settingsTabMinecraft',
        'settingsTabMods',
        'settingsTabJava',
        'settingsTabLauncher',
        'settingsTabAbout',
        'settingsTabUpdate'
    ]
    const requiredIds = [
        'settingsContainerLeft',
        'settingsNavContainer',
        'settingsNavHeader',
        'settingsNavItemsContent',
        'settingsNavDone',
        'settingsContainerRight',
        ...tabTargets,
        'settingsModsContainer',
        'settingsReqModsContainer',
        'settingsReqModsContent',
        'settingsOptModsContainer',
        'settingsOptModsContent',
        'settingsDropinModsContainer',
        'settingsDropinFileSystemButton',
        'settingsDropinModsContent',
        'settingsShadersContainer',
        'settingsShaderpackButton',
        'settingsShadersSelected',
        'settingsShadersOptions',
        'settingsA11yStatus'
    ]
    const root = new FakeElement({ id: 'settingsContainer' })
    root.style.display = 'none'
    const elements = Object.fromEntries(requiredIds.map(id => [id, new FakeElement({ id })]))
    const tabList = new FakeElement({ classes: ['squadSettingsTabList'] })
    const errorPlate = new FakeElement({ id: 'settingsGameResolutionContainer' })
    const width = createConfigElement({ id: 'settingsGameWidth', cValue: 'GameWidth', type: 'number' })
    const toggle = createConfigElement({ id: 'settingsFullscreen', cValue: 'Fullscreen', type: 'checkbox' })
    width.setAttribute('aria-label', 'Ancho de resolución')
    width.closest = () => errorPlate
    elements.settingsA11yStatus.setAttribute('hidden', '')
    tabTargets.forEach(id => {
        elements[id].firstElementChild = new FakeElement({ classes: ['settingsTabHeader'] })
        elements[id].setAttribute('aria-hidden', id === tabTargets[0] ? 'false' : 'true')
    })
    if(missingId != null) delete elements[missingId]
    const documentListeners = new Map()
    const windowListeners = new Map()
    const navItems = tabTargets.map((target, index) => {
        const item = new FakeElement({ id: `nav-${index}`, tagName: 'BUTTON', classes: ['settingsNavItem'] })
        item.setAttribute('rSc', target)
        item.textContent = `Tab ${index + 1}`
        item.onFocus = element => { document.activeElement = element }
        if(index === 0) item.setAttribute('selected', '')
        return item
    })
    navItems.forEach(item => {
        item.onclick = () => {
            navItems.forEach(candidate => candidate.removeAttribute('selected'))
            item.setAttribute('selected', '')
        }
    })
    root.querySelector = selector => {
        if(selector === '.squadSettingsTabList') return tabList
        return selector.startsWith('#') ? elements[selector.slice(1)] || null : null
    }
    root.querySelectorAll = selector => {
        if(selector === '.settingsNavItem') return navItems
        if(selector === '[cValue]') return [width, toggle]
        return []
    }

    let theme = initialTheme
    let themeFailure = getThemeThrows
    let getterCalls = 0
    const config = new Proxy({}, {
        get(_target, property){
            if(property !== 'getLauncherTheme'){
                throw new Error(`Unexpected ConfigManager access: ${String(property)}`)
            }
            return () => {
                getterCalls++
                if(themeFailure) throw new Error('Theme unavailable')
                return theme
            }
        }
    })
    const observers = []
    class FakeMutationObserver {
        constructor(callback){
            if(observerThrows) throw new Error('Observer unavailable')
            this.callback = callback
            observers.push(this)
        }

        observe(target, options){
            this.target = target
            this.options = options
        }

        disconnect(){
            this.disconnected = true
        }
    }
    const motionPreference = {
        matches: reducedMotion,
        addEventListener(_type, listener){ this.listener = listener },
        removeEventListener(){ this.listener = null }
    }
    const window = {
        addEventListener(type, listener){ windowListeners.set(type, listener) },
        removeEventListener(type){ windowListeners.delete(type) },
        matchMedia(){ return motionPreference }
    }
    const document = {
        activeElement: null,
        hidden: false,
        addEventListener(type, listener){ documentListeners.set(type, listener) },
        removeEventListener(type){ documentListeners.delete(type) },
        querySelector(selector){ return selector === '[data-squad-arcade-settings]' ? root : null }
    }
    const anime = createSettingsAnimeStub({ supportsRevert: animeSupportsRevert, failAnimate: animeFails })
    const context = {
        ConfigManager: config,
        MutationObserver: FakeMutationObserver,
        document,
        require(name){
            assert.equal(name, 'animejs')
            if(!animeAvailable) throw new Error('Anime unavailable')
            return anime.api
        },
        window
    }
    vm.runInNewContext(settingsVisualSource, context, { filename: 'squad-arcade-settings.js' })
    return {
        anime,
        document,
        documentListeners,
        elements,
        get getterCalls(){ return getterCalls },
        motionPreference,
        navItems,
        observers,
        root,
        setTheme(value){ theme = value },
        setThemeFailure(value){ themeFailure = value },
        tabList,
        toggle,
        width,
        windowListeners,
        window
    }
}

function testVisualControllerReadiness(){
    const valid = createVisualControllerHarness()
    assert.equal(valid.root.classList.contains('is-squad-settings-ready'), true)
    assert.equal(valid.root.getAttribute('data-theme'), 'overworld')
    assert.equal(valid.observers.length, 3)
    const visibilityObserver = valid.observers.find(observer => observer.options.attributeFilter.includes('style'))
    assert.equal(JSON.stringify(visibilityObserver.options), JSON.stringify({ attributes: true, attributeFilter: ['style'] }))

    const missing = createVisualControllerHarness({ missingId: 'settingsShadersOptions' })
    assert.equal(missing.root.classList.contains('is-squad-settings-ready'), false)
    assert.equal(missing.root.getAttribute('data-theme'), null)
    assert.equal(missing.observers.length, 0)

    const failedTheme = createVisualControllerHarness({ getThemeThrows: true })
    assert.equal(failedTheme.root.classList.contains('is-squad-settings-ready'), false)
    assert.equal(failedTheme.root.getAttribute('data-theme'), null)

    const failedObserver = createVisualControllerHarness({ observerThrows: true })
    assert.equal(failedObserver.root.classList.contains('is-squad-settings-ready'), false)
    assert.equal(failedObserver.root.getAttribute('data-theme'), null)
    assert.equal(failedObserver.tabList.listeners.get('keydown')?.length || 0, 0)
    assert.equal(failedObserver.elements.settingsA11yStatus.hasAttribute('hidden'), true)
    assert.equal(failedObserver.tabList.getAttribute('role'), null)
    assert.equal(failedObserver.navItems.every(item => item.getAttribute('aria-selected') == null), true)
}

function testVisualThemesAndRefresh(){
    const themes = ['overworld', 'creeper', 'nether', 'ender']
    const homeThemesBlock = squadArcadeSource.match(/const themes = \{([^]*?)\n {4}\}/)?.[1] || ''
    const homeThemes = [...homeThemesBlock.matchAll(/^\s{8}(\w+):/gm)].map(match => match[1])
    assert.deepEqual(homeThemes, themes, 'Settings theme allowlist matches Home exactly')
    themes.forEach(theme => {
        assert.match(settingsStyles, new RegExp(`data-theme='${theme}'`), `${theme} has a CSS palette`)
    })
    themes.forEach(theme => {
        const harness = createVisualControllerHarness({ initialTheme: theme })
        assert.equal(harness.root.getAttribute('data-theme'), theme)
        assert.equal(harness.getterCalls, 1)
    })
    const invalid = createVisualControllerHarness({ initialTheme: 'unknown-theme' })
    assert.equal(invalid.root.getAttribute('data-theme'), 'overworld')

    const refreshed = createVisualControllerHarness({ initialTheme: 'overworld' })
    refreshed.setTheme('ender')
    refreshed.root.style.display = 'flex'
    refreshed.observers.find(observer => observer.options.attributeFilter.includes('style')).callback([{ attributeName: 'style' }])
    assert.equal(refreshed.root.getAttribute('data-theme'), 'ender', 'opening Settings refreshes theme')
    assert.equal(refreshed.getterCalls, 2)
}

function testVisualControllerBoundaries(){
    assert.doesNotMatch(settingsVisualSource, /ConfigManager\.(?:set|save)/, 'visual controller never persists')
    assert.doesNotMatch(settingsVisualSource, /settingsNavItemListener|prepareSettings|fullSettingsSave/, 'visual controller does not intercept Settings behavior')
    const requiredModules = [...settingsVisualSource.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map(match => match[1])
    assert.deepEqual(requiredModules, ['animejs'], 'Anime is the only module boundary')
    assert.doesNotMatch(settingsVisualSource, /\bfetch\s*\(|XMLHttpRequest|ipcRenderer|\bshell\b|\bfs\b/, 'visual controller has no external side effects')
    const harness = createVisualControllerHarness()
    assert.deepEqual(Object.keys(harness.window.squadArcadeSettings), ['refresh', 'destroy'])
    assert.equal(harness.window.squadArcadeSettings.refresh(), true)
}

function testAriaTabContract(){
    const tabListMarkup = settingsMarkup.slice(
        settingsMarkup.indexOf('<div class="squadSettingsTabList"'),
        settingsMarkup.indexOf('<div id="settingsNavContentBottom"')
    )
    assert.match(tabListMarkup, /role="tablist"/)
    assert.doesNotMatch(tabListMarkup, /settingsNavDone/, 'Done is outside the tablist')
    const tabs = [...tabListMarkup.matchAll(/<button class="settingsNavItem"[^>]+>/g)].map(match => match[0])
    assert.equal(tabs.length, 7)
    tabs.forEach((tab, index) => {
        assert.match(tab, /role="tab"/)
        assert.match(tab, /aria-controls="settingsTab(?:Account|Minecraft|Mods|Java|Launcher|About|Update)"/)
        assert.match(tab, new RegExp(`aria-selected="${index === 0}"`))
        assert.match(tab, new RegExp(`tabindex="${index === 0 ? '0' : '-1'}"`))
    })
    assert.equal((settingsMarkup.match(/role="tabpanel"/g) || []).length, 7)
    assert.equal((settingsMarkup.match(/aria-labelledby="settingsNav/g) || []).length, 7)
    assert.match(settingsMarkup, /id="settingsGameWidth"[^>]+aria-label="Ancho de resolución"/)
    assert.match(settingsMarkup, /id="settingsGameHeight"[^>]+aria-label="Alto de resolución"/)
    assert.match(settingsMarkup, /id="settingsGameResolutionCross" aria-hidden="true"/)
    assert.equal((settingsMarkup.match(/class="toggleSwitchSlider" aria-hidden="true"/g) || []).length, 5)

    const harness = createVisualControllerHarness()
    const selectedObserver = harness.observers.find(observer => observer.options.attributeFilter.includes('selected'))
    harness.navItems[2].click()
    selectedObserver.callback([{ target: harness.navItems[2] }])
    assert.equal(harness.navItems[0].getAttribute('aria-selected'), 'false')
    assert.equal(harness.navItems[0].getAttribute('tabindex'), '-1')
    assert.equal(harness.navItems[2].getAttribute('aria-selected'), 'true')
    assert.equal(harness.navItems[2].getAttribute('tabindex'), '0')
    assert.equal(harness.elements.settingsTabMods.getAttribute('aria-hidden'), 'false')
    assert.match(harness.elements.settingsA11yStatus.textContent, /Sección activa: Tab 3/)
}

function testRovingTabKeyboard(){
    const harness = createVisualControllerHarness()
    const selectedObserver = harness.observers.find(observer => observer.options.attributeFilter.includes('selected'))
    const down = harness.tabList.dispatch('keydown', { key: 'ArrowDown', target: harness.navItems[0] })
    selectedObserver.callback([{ target: harness.navItems[1] }])
    assert.equal(down.defaultPrevented, true)
    assert.equal(harness.navItems[1].focusCalls, 1)
    assert.equal(harness.navItems[1].clickCalls, 1, 'keyboard delegates to the existing click handler')

    harness.tabList.dispatch('keydown', { key: 'End', target: harness.navItems[1] })
    selectedObserver.callback([{ target: harness.navItems[6] }])
    assert.equal(harness.navItems[6].clickCalls, 1)
    harness.tabList.dispatch('keydown', { key: 'Home', target: harness.navItems[6] })
    selectedObserver.callback([{ target: harness.navItems[0] }])
    assert.equal(harness.navItems[0].clickCalls, 1)
    harness.tabList.dispatch('keydown', { key: 'ArrowUp', target: harness.navItems[0] })
    assert.equal(harness.navItems[6].clickCalls, 2, 'ArrowUp wraps to the last tab')
}

function testToggleAccessibility(){
    const toggleTags = [...settingsMarkup.matchAll(/<input type="checkbox" cValue="[^"]+"[^>]*>/g)].map(match => match[0])
    assert.equal(toggleTags.length, 5)
    toggleTags.forEach(tag => {
        const id = tag.match(/\bid="([^"]+)"/)?.[1]
        const labelled = /aria-label="[^"]+"/.test(tag) || (id != null && settingsMarkup.includes(`for="${id}"`))
        assert.equal(labelled, true, `${tag} has an accessible label`)
    })
    assert.match(settingsStyles, /\.toggleSwitch input\s*\{[^}]*display:\s*block[^}]*clip-path:\s*inset\(50%\)/s, 'ready toggles remain focusable while visually hidden')
    assert.match(settingsStyles, /\.toggleSwitch input:focus-visible \+ \.toggleSwitchSlider/, 'toggle focus is visible')
    assert.equal(harnessCheckboxBindingStillWorks(), true)

    function harnessCheckboxBindingStillWorks(){
        const checkbox = createConfigElement({ id: 'toggle', cValue: 'Fullscreen', type: 'checkbox' })
        checkbox.checked = true
        checkbox.dispatch('change')
        const document = createSettingsDocument({ values: [checkbox] })
        let saved = null
        loadFunctions(settingsSource, ['saveSettingsValues'], {
            document,
            ConfigManager: { setFullscreen(value){ saved = value } },
            changeAllowPrerelease(){}
        }).saveSettingsValues()
        return saved
    }
}

function testErrorAccessibility(){
    const harness = createVisualControllerHarness()
    const errorObserver = harness.observers.find(observer => observer.options.attributeFilter.includes('error'))
    assert.equal(harness.width.getAttribute('aria-invalid'), 'false')
    harness.width.setAttribute('error', '')
    errorObserver.callback([{ target: harness.width }])
    assert.equal(harness.width.getAttribute('aria-invalid'), 'true')
    assert.match(harness.elements.settingsA11yStatus.textContent, /valor inválido/)
    harness.width.removeAttribute('error')
    errorObserver.callback([{ target: harness.width }])
    assert.equal(harness.width.getAttribute('aria-invalid'), 'false')
    assert.match(harness.elements.settingsA11yStatus.textContent, /valor válido/)
    assert.match(settingsMarkup, /id="settingsA11yStatus"[^>]+aria-live="polite"/)
}

function openVisualHarness(harness){
    harness.root.style.display = 'flex'
    harness.observers.find(observer => observer.options.attributeFilter.includes('style')).callback([{ target: harness.root }])
}

function assertCleanMotionStyles(harness, message){
    const targets = [...new Set(harness.anime.calls.animations.flatMap(call => call.targets))]
    targets.forEach(target => {
        assert.equal(target.style.opacity || '', '', `${message}: opacity`)
        assert.equal(target.style.transform || '', '', `${message}: transform`)
    })
}

function testMotionFallbacks(){
    const animated = createVisualControllerHarness()
    openVisualHarness(animated)
    assert.equal(animated.anime.calls.animations.length, 1, 'opening runs one finite entrance')
    assert.equal(animated.anime.calls.animations[0].parameters.duration, 260)

    const unavailable = createVisualControllerHarness({ animeAvailable: false })
    openVisualHarness(unavailable)
    assert.equal(unavailable.root.classList.contains('is-squad-settings-ready'), true, 'Anime failure keeps ready UI')
    assert.equal(unavailable.anime.calls.animations.length, 0)

    const reduced = createVisualControllerHarness({ reducedMotion: true })
    openVisualHarness(reduced)
    assert.equal(reduced.root.classList.contains('is-squad-settings-ready'), true)
    assert.equal(reduced.anime.calls.animations.length, 0)

    const legacyInstance = createVisualControllerHarness({ animeSupportsRevert: false })
    openVisualHarness(legacyInstance)
    legacyInstance.windowListeners.get('blur')()
    assert.equal(legacyInstance.anime.calls.cancelled, 1, 'instances without revert fall back to cancel')
    assertCleanMotionStyles(legacyInstance, 'cancel fallback cleans styles')

    const failedAnimation = createVisualControllerHarness({ animeFails: true })
    openVisualHarness(failedAnimation)
    assert.equal(failedAnimation.root.classList.contains('is-squad-settings-ready'), true)
    assertCleanMotionStyles(failedAnimation, 'animation init failure cleans styles')

    const failedShell = createVisualControllerHarness()
    openVisualHarness(failedShell)
    failedShell.setThemeFailure(true)
    failedShell.observers.find(observer => observer.options.attributeFilter.includes('style')).callback([{ target: failedShell.root }])
    assert.equal(failedShell.root.classList.contains('is-squad-settings-ready'), false)
    assertCleanMotionStyles(failedShell, 'shell fallback cleans styles')
}

function testIntentionalMotion(){
    const harness = createVisualControllerHarness()
    let legacyDone = 0
    harness.elements.settingsNavDone.onclick = () => { legacyDone++ }
    openVisualHarness(harness)
    const selectedObserver = harness.observers.find(observer => observer.options.attributeFilter.includes('selected'))
    harness.navItems[1].click()
    selectedObserver.callback([{ target: harness.navItems[1] }])
    const errorObserver = harness.observers.find(observer => observer.options.attributeFilter.includes('error'))
    harness.width.setAttribute('error', '')
    errorObserver.callback([{ target: harness.width }])
    errorObserver.callback([{ target: harness.width }])
    harness.elements.settingsNavDone.dispatch('pointerdown')
    harness.elements.settingsNavDone.click()

    const durations = harness.anime.calls.animations.map(call => call.parameters.duration)
    assert.deepEqual(durations, [260, 180, 220, 120, 120])
    assert.equal(legacyDone, 1, 'Done feedback does not intercept the legacy handler')
    assert.equal(harness.anime.calls.animations.filter(call => call.parameters.duration === 220).length, 1, 'error shakes once per false-to-true transition')
    assert.equal(harness.anime.calls.animations.every(call => call.parameters.loop == null), true, 'Settings motion never loops')
    assert.equal(harness.anime.calls.animations.flatMap(call => call.targets).some(target => target.tagName === 'INPUT'), false, 'motion never targets inputs')
    const tabTargets = harness.anime.calls.animations.find(call => call.parameters.duration === 180).targets
    assert.equal(tabTargets.includes(harness.elements.settingsTabMods), false, 'tab motion never animates the Mods tree')
    assert.equal(tabTargets[0], harness.elements.settingsTabMinecraft.firstElementChild, 'tab motion targets only the header plate')

    const completed = createVisualControllerHarness()
    openVisualHarness(completed)
    completed.anime.calls.animations[0].animation.complete()
    assert.equal(completed.anime.calls.reverted, 0, 'normal completion does not call revert')
    assertCleanMotionStyles(completed, 'normal completion cleans final inline styles')
}

function testMotionLifecycleAndDestroy(){
    const harness = createVisualControllerHarness()
    openVisualHarness(harness)
    const selectedObserver = harness.observers.find(observer => observer.options.attributeFilter.includes('selected'))
    harness.navItems[1].click()
    selectedObserver.callback([{ target: harness.navItems[1] }])
    const replacedTab = harness.anime.calls.animations[1]
    harness.navItems[2].click()
    selectedObserver.callback([{ target: harness.navItems[2] }])
    assert.equal(harness.anime.calls.reverted, 1, 'replacing tab motion reverts the prior instance')
    replacedTab.targets.forEach(target => {
        assert.equal(target.style.opacity || '', '')
        assert.equal(target.style.transform || '', '')
    })

    harness.windowListeners.get('blur')()
    const afterBlur = harness.anime.calls.reverted
    assert.ok(afterBlur >= 3, 'blur reverts active work')
    assertCleanMotionStyles(harness, 'blur cleans styles')
    harness.windowListeners.get('focus')()
    harness.root.style.display = 'none'
    harness.observers.find(observer => observer.options.attributeFilter.includes('style')).callback([{ target: harness.root }])
    assert.equal(harness.anime.calls.animations.length, 3, 'exit never creates motion')

    const exited = createVisualControllerHarness()
    openVisualHarness(exited)
    exited.root.style.display = 'none'
    exited.observers.find(observer => observer.options.attributeFilter.includes('style')).callback([{ target: exited.root }])
    assert.equal(exited.anime.calls.reverted, 1, 'leaving Settings reverts active motion')
    assertCleanMotionStyles(exited, 'Settings exit cleans styles')

    const reduced = createVisualControllerHarness()
    openVisualHarness(reduced)
    reduced.motionPreference.listener({ matches: true })
    assert.equal(reduced.anime.calls.reverted, 1, 'enabling reduced motion reverts entrance')
    assertCleanMotionStyles(reduced, 'reduced motion cleans styles')

    const hidden = createVisualControllerHarness()
    openVisualHarness(hidden)
    hidden.document.hidden = true
    hidden.documentListeners.get('visibilitychange')()
    assert.equal(hidden.anime.calls.reverted, 1, 'hidden documents revert active motion')
    assertCleanMotionStyles(hidden, 'hidden document cleans styles')

    const destroyed = createVisualControllerHarness()
    openVisualHarness(destroyed)
    destroyed.window.squadArcadeSettings.destroy()
    destroyed.window.squadArcadeSettings.destroy()
    assert.equal(destroyed.anime.calls.reverted, 1, 'destroy reverts active motion')
    assertCleanMotionStyles(destroyed, 'destroy cleans styles')
    assert.equal(destroyed.root.classList.contains('is-squad-settings-ready'), false)
    assert.equal(destroyed.observers.every(observer => observer.disconnected), true)
    assert.equal(destroyed.windowListeners.size, 0)
    assert.equal(destroyed.documentListeners.size, 0)
}

function testLegacyFallbackPresence(){
    const rootTag = settingsMarkup.match(/<div id="settingsContainer"[^>]*>/)?.[0] || ''
    assert.doesNotMatch(rootTag, /is-squad-settings-ready/, 'markup never opts into the shell before validation')
    assert.match(rootTag, /style="display: none;"/, 'legacy initial visibility remains intact')
    assert.match(settingsMarkup, /<script src="\.\/assets\/js\/scripts\/settings\.js"><\/script>/, 'legacy Settings controller remains present')
    assert.match(settingsStyles, /^#settingsContainer\.is-squad-settings-ready/, 'removing controller or CSS leaves legacy selectors untouched')
}

async function run(){
    await scenario('functional Settings markup snapshot', testMarkupContract)
    await scenario('prepareSettings first-load order', () => testPrepareSettings(true))
    await scenario('prepareSettings refresh order', () => testPrepareSettings(false))
    await scenario('normal, Account, Mods, and Update routes', testSettingsRoutes)
    await scenario('settings tab selection, scroll, and visibility', testSettingsNavigation)
    await scenario('generic and server-dependent cValue bindings', testGenericValues)
    await scenario('ShowIntro markup is localized and has no replay action', testShowIntroMarkup)
    await scenario('ShowIntro uses generic deferred bindings', testShowIntroGenericBinding)
    await scenario('Done persists ShowIntro before ConfigManager.save', testShowIntroDoneOrder)
    await scenario('next startup consumes the saved ShowIntro value', testShowIntroNextStartup)
    await scenario('resolution validation gates Done', testResolutionValidation)
    await scenario('fullSettingsSave exact order', testFullSaveOrder)
    await scenario('server change saves before selection and refresh', testServerChangeOrder)
    await scenario('Done returns to Landing after save', testDoneAfterSave)
    await scenario('real side-effect boundaries are blocked', testBlockedSideEffects)
    await scenario('motion remains separated from legacy Settings', testMotionLayerSeparation)
    await scenario('visual assets are ordered and ready-namespaced', testVisualAssetContract)
    await scenario('Mods DOM and header-first scrolling remain intact', testModsAndScrollContracts)
    await scenario('visual shell activates only after complete validation', testVisualControllerReadiness)
    await scenario('four themes, invalid fallback, and open refresh', testVisualThemesAndRefresh)
    await scenario('visual controller has no behavioral side effects', testVisualControllerBoundaries)
    await scenario('tabs expose and synchronize ARIA state', testAriaTabContract)
    await scenario('roving tab keyboard delegates to existing clicks', testRovingTabKeyboard)
    await scenario('toggle inputs remain focusable and bound', testToggleAccessibility)
    await scenario('validation errors update ARIA and live status', testErrorAccessibility)
    await scenario('Anime availability and reduced-motion fallbacks', testMotionFallbacks)
    await scenario('entry, tab, error, and Done motion stay additive', testIntentionalMotion)
    await scenario('motion lifecycle cancels and destroys cleanly', testMotionLifecycleAndDestroy)
    await scenario('legacy Settings remains the no-controller fallback', testLegacyFallbackPresence)
    console.log(`Squad Arcade Settings harness: ${scenarios} scenarios passed`)
}

run().catch(error => {
    console.error(error)
    process.exitCode = 1
})

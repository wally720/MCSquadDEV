const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const projectRoot = path.join(__dirname, '..')
const settingsSource = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'js', 'scripts', 'settings.js'), 'utf8')
const settingsMarkup = fs.readFileSync(path.join(projectRoot, 'app', 'settings.ejs'), 'utf8')
const landingMarkup = fs.readFileSync(path.join(projectRoot, 'app', 'landing.ejs'), 'utf8')
const landingSource = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'js', 'scripts', 'landing.js'), 'utf8')
const squadArcadeSource = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'js', 'scripts', 'squad-arcade.js'), 'utf8')
const uiCoreSource = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'js', 'scripts', 'uicore.js'), 'utf8')
const uiBinderSource = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'js', 'scripts', 'uibinder.js'), 'utf8')
const appMarkup = fs.readFileSync(path.join(projectRoot, 'app', 'app.ejs'), 'utf8')
const languageSource = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'lang', 'en_US.toml'), 'utf8')
const settingsStyles = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'css', 'squad-arcade-settings.css'), 'utf8')
const settingsVisualSource = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'js', 'scripts', 'squad-arcade-settings.js'), 'utf8')
const dropinModUtilSource = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'js', 'dropinmodutil.js'), 'utf8')
const processBuilderSource = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'js', 'processbuilder.js'), 'utf8')
const settingsModsStyles = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'css', 'squad-arcade-settings-mods.css'), 'utf8')
const settingsModsVisualSource = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'js', 'scripts', 'squad-arcade-settings-mods.js'), 'utf8')

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

function loadDropinModUtil(fsStub, electronStub = { ipcRenderer: blockedBoundary('IPC'), shell: blockedBoundary('shell') }, consoleStub = console){
    const module = { exports: {} }
    const sandbox = {
        console: consoleStub,
        exports: module.exports,
        module,
        require(name){
            if(name === 'fs-extra') return fsStub
            if(name === 'path') return path
            if(name === 'electron') return electronStub
            if(name === './ipcconstants') return { SHELL_OPCODE: { TRASH_ITEM: 'trash-item' } }
            throw new Error(`Unexpected module: ${name}`)
        }
    }
    vm.runInNewContext(dropinModUtilSource, sandbox, { filename: 'dropinmodutil.js' })
    return module.exports
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

    toggle(value, force){
        const enabled = force == null ? !this.values.has(value) : force
        if(enabled){
            this.values.add(value)
        } else {
            this.values.delete(value)
        }
        return enabled
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
        this.children = []
        this.childNodes = this.children
        this.parentNode = null
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

    appendChild(child){
        child.parentNode = this
        this.children.push(child)
        return child
    }

    remove(){
        if(this.parentNode != null){
            this.parentNode.children = this.parentNode.children.filter(child => child !== this)
            this.parentNode.childNodes = this.parentNode.children
            this.parentNode = null
        }
        this.removed = true
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
        'settingsUpdateAvailableIndicator',
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
            startupSurface: new FakeElement()
        }
        const sut = loadFunctions(uiBinderSource, ['hideStartupSurface', 'showIntroForStartup'], {
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
    const context = {
        getCurrentView(){ return '#settingsContainer' },
        VIEWS: { settings: '#settingsContainer' },
        fullSettingsSave(){ calls.push('fullSettingsSave') },
        ConfigManager: {
            setSelectedServer(id){ calls.push(`setSelectedServer:${id}`) },
            save(){ calls.push('ConfigManager.save') }
        },
        animateSettingsTabRefresh(){ calls.push('refresh') },
        setLaunchEnabled(value){ calls.push(['setLaunchEnabled', value]) },
        window: { squadArcade: { updateServer(server){ calls.push(['squadArcade.updateServer', server?.rawServer?.id || null]) } } }
    }
    const sut = loadFunctions(landingSource, ['updateSelectedServer'], context)
    sut.updateSelectedServer({ rawServer: { id: 'server-b', name: 'Beta', icon: 'beta.png' } })
    assert.deepEqual(calls.slice(0, 4), [
        'fullSettingsSave',
        'setSelectedServer:server-b',
        'ConfigManager.save',
        'refresh'
    ])
    assert.deepEqual(calls.slice(-2), [['setLaunchEnabled', true], ['squadArcade.updateServer', 'server-b']])

    calls.length = 0
    sut.updateSelectedServer(null)
    assert.equal(calls.includes('setSelectedServer:null'), true)
    assert.deepEqual(calls.slice(-2), [['setLaunchEnabled', false], ['squadArcade.updateServer', null]])
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
        settingsNavAccount: new FakeElement({ id: 'settingsNavAccount' }),
        settingsNavMods: new FakeElement({ id: 'settingsNavMods' }),
        settingsNavUpdate: new FakeElement({ id: 'settingsNavUpdate' }),
        settingsUpdateAvailableIndicator: new FakeElement({ id: 'settingsUpdateAvailableIndicator' })
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
    const open = loadFunctions(squadArcadeSource, ['openSettings'], common)
    await open.openSettings()
    assert.deepEqual(calls.splice(0), ['prepare', 'switch:#settingsContainer'])
    await open.openSettings('settingsNavAccount')
    assert.deepEqual(calls.splice(0), ['prepare', 'switch:#settingsContainer', 'tab:settingsNavAccount:false'])

    await open.openSettings('settingsNavMods')
    assert.deepEqual(calls.splice(0), ['prepare', 'switch:#settingsContainer', 'tab:settingsNavMods:false'])

    const update = loadFunctions(uiCoreSource, ['showUpdateUI'], common)
    update.showUpdateUI({ version: '2.0.0' })
    assert.equal(elements.settingsNavUpdate.hasAttribute('update'), true)
    assert.equal(elements.settingsNavUpdate.getAttribute('aria-describedby'), 'settingsUpdateAvailableIndicator')
    assert.equal(elements.settingsUpdateAvailableIndicator.hidden, false)
    assert.deepEqual(calls, [], 'updater marks the existing Settings action without synthetic navigation')
    assert.match(settingsMarkup, /id="settingsUpdateAvailableIndicator"[^>]*role="status"[^>]*aria-live="polite"[^>]*hidden/)
    assert.doesNotMatch(landingMarkup, /image_seal_container|updateAvailableTooltip/)
}

function testUpdaterRuntimeContract(){
    for(const event of ['checking-for-update', 'update-available', 'update-downloaded', 'update-not-available', 'ready', 'realerror']){
        assert.match(uiCoreSource, new RegExp(`case ['"]${event}['"]`), `${event} remains handled`)
    }
    assert.match(uiCoreSource, /populateSettingsUpdateInformation\(info\)/, 'available update details still populate Settings')
    assert.match(uiCoreSource, /settingsUpdateButtonStatus\([^]*installUpdateNow[^]*\)/, 'downloaded updates retain the install action')
    assert.match(uiCoreSource, /setInterval\([^]*checkForUpdate[^]*1800000\)/, 'periodic update checking remains active')
    assert.match(uiCoreSource, /loggerAutoUpdater\.error\('Error during update check\.\.'/ , 'unexpected updater failures remain logged')
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
    const startupIndex = appMarkup.indexOf('./assets/css/squad-arcade-startup.css')
    const introIndex = appMarkup.indexOf('./assets/css/squad-arcade-intro.css')
    const settingsIndex = appMarkup.indexOf('./assets/css/squad-arcade-settings.css')
    assert.ok(launcherIndex >= 0 && launcherIndex < settingsIndex, 'Settings CSS loads after launcher CSS')
    assert.ok(homeIndex >= 0 && homeIndex < settingsIndex, 'Settings CSS loads after Home CSS')
    assert.ok(homeIndex < startupIndex && startupIndex < introIndex, 'startup CSS loads between Home and Intro CSS')
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

function createDistroModule({ id, name, required, defaultValue = true, subModules = [], type = 'forge', version = '1.0.0' }){
    return {
        rawModule: { name, type },
        mavenComponents: { version },
        subModules,
        getRequired(){ return { def: defaultValue, value: required } },
        getVersionlessMavenIdentifier(){ return id },
        hasSubModules(){ return subModules.length > 0 }
    }
}

function createModFixture(){
    const coreApi = createDistroModule({ id: 'com.acme:core-api', name: 'Core API', required: true, version: '2.4.1' })
    const telemetry = createDistroModule({ id: 'com.acme:telemetry', name: 'Telemetry', required: false, defaultValue: false, version: '3.0.0' })
    const waypoint = createDistroModule({ id: 'com.acme:waypoints', name: 'Waypoints', required: false, defaultValue: true, version: '1.8.2' })
    return [
        createDistroModule({ id: 'com.acme:core', name: 'Core', required: true, subModules: [coreApi, telemetry], version: '2.4.1' }),
        createDistroModule({ id: 'com.acme:minimap', name: 'Minimap', required: false, defaultValue: true, subModules: [waypoint], version: '5.7.0' }),
        createDistroModule({ id: 'com.acme:voice', name: 'Voice', required: false, defaultValue: false, version: '4.1.0' })
    ]
}

function currentModConfiguration(modules){
    const origin = { getRequired(){ return { def: true, value: true } } }
    const sut = loadFunctions(uiBinderSource, ['scanOptionalSubModules'], {
        Type: { FabricMod: 'fabric', ForgeMod: 'forge', LiteLoader: 'liteloader', LiteMod: 'litemod' }
    })
    return JSON.parse(JSON.stringify(sut.scanOptionalSubModules(modules, origin)))
}

function testModsContractSnapshot(){
    const modsMarkup = settingsMarkup.slice(settingsMarkup.indexOf('id="settingsTabMods"'), settingsMarkup.indexOf('id="settingsTabJava"'))
    const ids = [...modsMarkup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1])
    assert.deepEqual(ids, [
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
    assert.match(modsMarkup, /id="settingsTabMods" class="settingsTab sa-module-bay" data-sa-bay="mods" role="tabpanel" aria-labelledby="settingsNavMods" aria-hidden="true" tabindex="0"/)
    assert.equal((modsMarkup.match(/class="settingsModsHeader(?: [^"]*)?"/g) || []).length, 4)
    assert.match(modsMarkup, /class="settingsSelServContent"/)
    assert.match(modsMarkup, /class="settingsSwitchServerButton"[^>]*aria-label="Cambiar servidor para configurar mods"/)
    assert.match(modsMarkup, /id="settingsDropinFileSystemButton"[^>]*aria-label="Agregar mods desde el sistema"/)
    assert.match(modsMarkup, /id="settingsShaderpackButton"[^>]*aria-label="Agregar paquete de shaders"/)
    assert.match(modsMarkup, /class="settingsSelectOptions" id="settingsShadersOptions" hidden/)
}

function testEquipmentRackMarkupContract(){
    const modsMarkup = settingsMarkup.slice(settingsMarkup.indexOf('id="settingsTabMods"'), settingsMarkup.indexOf('id="settingsTabJava"'))
    const orderedIds = [...modsMarkup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1])
    assert.deepEqual(orderedIds, [
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
    assert.match(modsMarkup, /class="settingsSelServContainer sa-equipment-server" data-sa-rack="active-server"/)
    assert.match(modsMarkup, /id="settingsModsContainer" class="sa-equipment-rack" data-sa-rack="equipment" data-sa-label="RACK \/\/ MÓDULOS DEL PACK"/)
    assert.match(modsMarkup, /id="settingsReqModsContainer" class="sa-mod-bank sa-mod-bank-required" data-sa-module-bank="required" data-sa-required-lock-slot/)
    assert.match(modsMarkup, /id="settingsOptModsContainer" class="sa-mod-bank sa-mod-bank-optional" data-sa-module-bank="optional"/)
    assert.match(modsMarkup, /id="settingsDropinModsContainer" class="sa-equipment-panel sa-equipment-panel-external" data-sa-rack="external-files"/)
    assert.match(modsMarkup, /id="settingsShadersContainer" class="sa-equipment-panel sa-equipment-panel-shaders" data-sa-rack="shaderpacks"/)
    assert.equal((modsMarkup.match(/class="settingsModsHeader sa-rack-heading"/g) || []).length, 4)
    assert.ok(modsMarkup.indexOf('settingsTabHeader') < modsMarkup.indexOf('sa-equipment-server'), 'Mods remains header-first')
    assert.ok(modsMarkup.indexOf('settingsReqModsContainer') < modsMarkup.indexOf('settingsOptModsContainer'))
    assert.ok(modsMarkup.indexOf('settingsOptModsContainer') < modsMarkup.indexOf('settingsDropinModsContainer'))
    assert.ok(modsMarkup.indexOf('settingsDropinModsContainer') < modsMarkup.indexOf('settingsShadersContainer'))
}

function testEquipmentRackStylesheetContract(){
    const serviceBayIndex = appMarkup.indexOf('./assets/css/squad-arcade-settings.css')
    const equipmentRackIndex = appMarkup.indexOf('./assets/css/squad-arcade-settings-mods.css')
    assert.ok(serviceBayIndex >= 0 && serviceBayIndex < equipmentRackIndex, 'equipment rack CSS loads after Service Bay')
    assert.equal((appMarkup.match(/squad-arcade-settings-mods\.css/g) || []).length, 1)

    const prefix = '#settingsContainer.is-squad-settings-ready #settingsTabMods.sa-module-bay'
    const selectorHeaders = [...settingsModsStyles.matchAll(/([^{}]+)\{/g)]
        .map(match => match[1].trim())
        .filter(header => !header.startsWith('@'))
    assert.ok(selectorHeaders.length > 0)
    selectorHeaders.forEach(header => {
        header.split(',').map(selector => selector.trim()).forEach(selector => {
            assert.equal(selector.startsWith(prefix), true, `rack selector is namespaced: ${selector}`)
        })
    })
    assert.doesNotMatch(settingsMarkup, /is-squad-settings-ready/, 'markup does not opt into the progressive stylesheet')
}

function testEquipmentRackLayoutContract(){
    assert.match(settingsModsStyles, /#settingsModsContainer\.sa-equipment-rack\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s)
    assert.match(settingsModsStyles, /@media \(max-width:\s*860px\)[^]*#settingsModsContainer\.sa-equipment-rack\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/)
    assert.doesNotMatch(settingsModsStyles, /\boverflow(?:-[xy])?\s*:/, 'rack adds no nested scrolling')
    assert.match(settingsStyles, /\.settingsTab\s*\{[^}]*overflow-y:\s*auto/s, 'the Settings tab remains the sole scroll owner')
    assert.match(settingsModsStyles, /--sa-rack-surface:\s*rgba\([^)]*,\s*0\.72\)/)
    assert.match(settingsModsStyles, /background:[^;}]*(?:rgba\(|var\(--sa-rack-surface|transparent)/)
    assert.doesNotMatch(settingsModsStyles, /background(?:-color)?:\s*#[0-9a-f]{3,8}/i, 'rack surfaces never become opaque hex backgrounds')
    assert.match(settingsModsStyles, /var\(--sa-settings-accent-rgb\)/, 'rack inherits Service Bay theme variables')
    assert.doesNotMatch(settingsModsStyles, /data-theme=/, 'rack adds no theme-specific logic')
}

function testEquipmentRackInteractionBoundaries(){
    const modsMarkup = settingsMarkup.slice(settingsMarkup.indexOf('id="settingsTabMods"'), settingsMarkup.indexOf('id="settingsTabJava"'))
    const staticButtons = [...modsMarkup.matchAll(/<button[^>]*>/g)].map(match => match[0])
    assert.equal(staticButtons.length, 3, 'rack adds no controls beyond the three legacy buttons')
    assert.match(staticButtons[0], /class="settingsSwitchServerButton"[^>]+data-sa-equipment-action="switch-server"/)
    assert.match(staticButtons[1], /id="settingsDropinFileSystemButton"[^>]+data-sa-equipment-action="open-mods-folder"/)
    assert.match(staticButtons[2], /id="settingsShaderpackButton"[^>]+data-sa-equipment-action="open-shader-folder"/)
    assert.match(modsMarkup, /id="settingsShadersSelected"/)
    assert.match(modsMarkup, /id="settingsShadersOptions" hidden/)
    assert.doesNotMatch(`${modsMarkup}\n${settingsModsStyles}`, /showOpenDialog|file.?picker|seleccionar archivo|confirm(?:ar|ación)/i)
    assert.doesNotMatch(settingsModsStyles, /badge|count|counter/i, 'rack invents no static counts')

    const pseudoBlocks = [...settingsModsStyles.matchAll(/([^{}]*::(?:before|after)[^{}]*)\{([^{}]*)\}/g)]
    assert.ok(pseudoBlocks.length > 0)
    pseudoBlocks.forEach(([, selector, declarations]) => {
        assert.match(declarations, /pointer-events:\s*none/, `${selector.trim()} cannot intercept input`)
    })
    assert.match(settingsModsStyles, /\[data-sa-required-lock-slot\][^{}]*\.sa-rack-heading::after\s*\{[^}]*opacity:\s*0/s, 'required lock remains a non-functional reserved slot')
}

class ModsHarnessElement extends FakeElement {
    constructor(options = {}){
        super(options)
        this.style = {
            display: '',
            opacity: '',
            transform: '',
            removeProperty(name){ this[name] = '' }
        }
    }

    appendChild(child){
        super.appendChild(child)
        if(this.children.length === 1){
            this.firstElementChild = child
        }
        return child
    }

    matches(selector){
        const notDropin = selector.includes(':not([dropin])')
        const normalized = selector.replace(':not([dropin])', '')
        const tag = normalized.match(/^[a-z]+/i)?.[0]
        if(tag != null && this.tagName !== tag.toUpperCase()) return false
        const id = normalized.match(/#([\w-]+)/)?.[1]
        if(id != null && this.id !== id) return false
        const classes = [...normalized.matchAll(/\.([\w-]+)/g)].map(match => match[1])
        if(classes.some(name => !this.classList.contains(name))) return false
        const attributes = [...normalized.matchAll(/\[([\w-]+)(?:=["']([^"']*)["'])?\]/g)]
        if(attributes.some(([, name, value]) => !this.hasAttribute(name) || (value != null && this.getAttribute(name) !== value))) return false
        if(notDropin && this.hasAttribute('dropin')) return false
        return true
    }

    querySelectorAll(selector){
        const result = []
        const visit = element => {
            element.children.forEach(child => {
                if(child.matches(selector)) result.push(child)
                visit(child)
            })
        }
        visit(this)
        return result
    }

    querySelector(selector){
        return this.querySelectorAll(selector)[0] || null
    }

    closest(selector){
        let current = this
        while(current != null){
            if(current.matches(selector)) return current
            current = current.parentNode
        }
        return null
    }

    toggleAttribute(name){
        if(this.hasAttribute(name)){
            this.removeAttribute(name)
        } else {
            this.setAttribute(name, '')
        }
    }

    dispatch(type, event = {}){
        const dispatched = event.__modsEvent || {
            target: event.target || this,
            key: event.key,
            defaultPrevented: false,
            propagationStopped: false,
            preventDefault(){ this.defaultPrevented = true },
            stopPropagation(){ this.propagationStopped = true }
        }
        dispatched.__modsEvent = dispatched
        this.listeners.get(type)?.forEach(listener => listener(dispatched))
        if(!dispatched.propagationStopped && this.parentNode != null){
            this.parentNode.dispatch(type, dispatched)
        }
        return dispatched
    }

    click(){
        if(this.disabled){
            return
        }
        this.clickCalls++
        const event = {
            target: this,
            key: undefined,
            defaultPrevented: false,
            propagationStopped: false,
            preventDefault(){ this.defaultPrevented = true },
            stopPropagation(){ this.propagationStopped = true }
        }
        event.__modsEvent = event
        this.onclick?.(event)
        if(!event.propagationStopped) this.dispatch('click', event)
    }
}

function createModsAnimeStub({ failAnimate = false, supportsRevert = true } = {}){
    const calls = { animations: [], cancelled: 0, reverted: 0 }
    return {
        calls,
        api: {
            animate(targets, parameters){
                const targetList = Array.from(targets)
                const originals = targetList.map(target => ({ target, opacity: target.style.opacity, transform: target.style.transform }))
                targetList.forEach(target => {
                    target.style.opacity = '0.55'
                    target.style.transform = 'translateY(7px)'
                })
                if(failAnimate) throw new Error('Animation failed')
                const animation = {
                    cancel(){ calls.cancelled++ },
                    complete(){ parameters.onComplete?.() }
                }
                if(supportsRevert){
                    animation.revert = () => {
                        calls.reverted++
                        originals.forEach(({ target, opacity, transform }) => {
                            target.style.opacity = opacity
                            target.style.transform = transform
                        })
                    }
                }
                calls.animations.push({ animation, parameters, targets: targetList })
                return animation
            }
        }
    }
}

function createModsAdapterHarness({ animeAvailable = true, animeFails = false, animeSupportsRevert = true, missingId = null, modsVisible = true, reducedMotion = false, serviceReady = true } = {}){
    const elements = new Map()
    const create = (id = '', options = {}) => {
        const element = new ModsHarnessElement({ id, ...options })
        if(id) elements.set(id, element)
        return element
    }
    const root = create('settingsContainer')
    root.style.display = 'flex'
    if(serviceReady) root.classList.add('is-squad-settings-ready')
    const tab = create('settingsTabMods', { classes: ['settingsTab', 'sa-module-bay'] })
    tab.style.display = modsVisible ? 'flex' : 'none'
    tab.setAttribute('aria-hidden', String(!modsVisible))
    const header = create('', { classes: ['settingsTabHeader'] })
    tab.appendChild(header)
    const server = create('', { classes: ['settingsSelServContainer', 'sa-equipment-server'] })
    const switchButton = create('', { tagName: 'BUTTON', classes: ['settingsSwitchServerButton'] })
    server.appendChild(switchButton)
    tab.appendChild(server)
    const modsContainer = create('settingsModsContainer', { classes: ['sa-equipment-rack'] })
    const requiredContainer = create('settingsReqModsContainer', { classes: ['sa-mod-bank'] })
    const requiredContent = create('settingsReqModsContent')
    const optionalContainer = create('settingsOptModsContainer', { classes: ['sa-mod-bank'] })
    const optionalContent = create('settingsOptModsContent')
    const dropinContainer = create('settingsDropinModsContainer', { classes: ['sa-equipment-panel'] })
    const dropButton = create('settingsDropinFileSystemButton', { tagName: 'BUTTON' })
    dropButton.setAttribute('aria-label', 'Agregar mods desde el sistema')
    const refreshNote = create('settingsDropinRefreshNote')
    const dropinContent = create('settingsDropinModsContent')
    const shadersContainer = create('settingsShadersContainer', { classes: ['sa-equipment-panel'] })
    const shaderDesc = create('settingsShaderpackDesc')
    const shaderButton = create('settingsShaderpackButton', { tagName: 'BUTTON' })
    shaderButton.setAttribute('aria-label', 'Agregar paquete de shaders')
    const shaderWrapper = create('settingsShaderpackWrapper')
    const selectContainer = create('', { classes: ['settingsSelectContainer'] })
    const shaderSelected = create('settingsShadersSelected', { classes: ['settingsSelectSelected'] })
    const shaderOptions = create('settingsShadersOptions', { classes: ['settingsSelectOptions'] })
    shaderOptions.setAttribute('hidden', '')
    selectContainer.appendChild(shaderSelected)
    selectContainer.appendChild(shaderOptions)
    shaderWrapper.appendChild(shaderButton)
    shaderWrapper.appendChild(selectContainer)
    shadersContainer.appendChild(shaderDesc)
    shadersContainer.appendChild(shaderWrapper)
    requiredContainer.appendChild(requiredContent)
    optionalContainer.appendChild(optionalContent)
    dropinContainer.appendChild(dropButton)
    dropinContainer.appendChild(refreshNote)
    dropinContainer.appendChild(dropinContent)
    modsContainer.appendChild(requiredContainer)
    modsContainer.appendChild(optionalContainer)
    modsContainer.appendChild(dropinContainer)
    modsContainer.appendChild(shadersContainer)
    tab.appendChild(modsContainer)
    root.appendChild(tab)
    const liveRegion = create('settingsA11yStatus')
    const doneButton = create('settingsNavDone', { tagName: 'BUTTON' })
    root.appendChild(liveRegion)
    root.appendChild(doneButton)

    function createCard(id, name, { checked = false, dropin = false, enabled = false, required = false, submod = false } = {}){
        const classes = ['settingsBaseMod', dropin ? 'settingsDropinMod' : submod ? 'settingsSubMod' : 'settingsMod']
        const card = create(id, { classes })
        if(enabled) card.setAttribute('enabled', '')
        const content = create('', { classes: ['settingsModContent'] })
        const main = create('', { classes: ['settingsModMainWrapper'] })
        const details = create('', { classes: ['settingsModDetails'] })
        const nameElement = create('', { classes: ['settingsModName'] })
        nameElement.textContent = name
        details.appendChild(nameElement)
        if(dropin){
            const remove = create('', { tagName: 'BUTTON', classes: ['settingsDropinRemoveButton'] })
            remove.setAttribute('remmod', id)
            remove.onclick = () => { remove.legacyRemovals = (remove.legacyRemovals || 0) + 1 }
            details.appendChild(remove)
        }
        main.appendChild(details)
        const label = create('', { tagName: 'LABEL', classes: ['toggleSwitch'] })
        if(required) label.setAttribute('reqmod', '')
        const input = create('', { tagName: 'INPUT', type: 'checkbox' })
        input.setAttribute('type', 'checkbox')
        input.checked = checked
        if(!required) input.setAttribute('formod', id)
        if(dropin) input.setAttribute('dropin', '')
        const slider = create('', { classes: ['toggleSwitchSlider'] })
        label.appendChild(input)
        label.appendChild(slider)
        content.appendChild(main)
        content.appendChild(label)
        card.appendChild(content)
        return { card, details, input, label, nameElement, remove: details.querySelector('[remmod]') }
    }

    const required = createCard('com.acme:core', 'Core', { checked: true, enabled: true, required: true })
    const subContainer = create('', { classes: ['settingsSubModContainer'] })
    const optionalSubmod = createCard('com.acme:telemetry', 'Telemetry', { submod: true })
    subContainer.appendChild(optionalSubmod.card)
    required.card.appendChild(subContainer)
    requiredContent.appendChild(required.card)
    const optional = createCard('com.acme:minimap', 'Minimap', { checked: true, enabled: true })
    optionalContent.appendChild(optional.card)
    const dropin = createCard('external.jar.disabled', 'External', { dropin: true })
    dropinContent.appendChild(dropin.card)
    const off = create('', { tagName: 'DIV' })
    off.textContent = 'Off (Default)'
    off.setAttribute('value', 'OFF')
    off.setAttribute('selected', '')
    const zip = create('', { tagName: 'DIV' })
    zip.textContent = 'Cinematic'
    zip.setAttribute('value', 'cinematic.zip')
    off.onclick = () => { off.legacySelections = (off.legacySelections || 0) + 1 }
    zip.onclick = () => { zip.legacySelections = (zip.legacySelections || 0) + 1 }
    shaderSelected.onclick = () => {
        shaderSelected.legacyClicks = (shaderSelected.legacyClicks || 0) + 1
        shaderOptions.toggleAttribute('hidden')
    }
    shaderOptions.appendChild(off)
    shaderOptions.appendChild(zip)

    if(missingId != null){
        const missing = elements.get(missingId)
        if(missing?.parentNode != null){
            missing.parentNode.children = missing.parentNode.children.filter(child => child !== missing)
            missing.parentNode.childNodes = missing.parentNode.children
        }
        elements.delete(missingId)
    }

    const observers = []
    class ModsMutationObserver {
        constructor(callback){
            this.callback = callback
            this.observations = []
            observers.push(this)
        }

        observe(target, options){ this.observations.push({ options, target }) }
        disconnect(){ this.disconnected = true }
    }
    const documentListeners = new Map()
    const windowListeners = new Map()
    const document = {
        activeElement: null,
        hidden: false,
        addEventListener(type, listener){ documentListeners.set(type, listener) },
        removeEventListener(type){ documentListeners.delete(type) },
        querySelector(selector){ return selector === '[data-squad-arcade-settings]' ? root : null }
    }
    ModsHarnessElement.prototype.focus = function(){
        this.focusCalls++
        document.activeElement = this
    }
    const frames = new Map()
    let nextFrame = 1
    const motionPreference = {
        matches: reducedMotion,
        addEventListener(_type, listener){ this.listener = listener },
        removeEventListener(){ this.listener = null }
    }
    const window = {
        addEventListener(type, listener){ windowListeners.set(type, listener) },
        removeEventListener(type){ windowListeners.delete(type) },
        cancelAnimationFrame(id){ frames.delete(id) },
        matchMedia(){ return motionPreference },
        requestAnimationFrame(callback){ const id = nextFrame++; frames.set(id, callback); return id }
    }
    const anime = createModsAnimeStub({ failAnimate: animeFails, supportsRevert: animeSupportsRevert })
    const context = {
        MutationObserver: ModsMutationObserver,
        document,
        require(name){
            assert.equal(name, 'animejs')
            if(!animeAvailable) throw new Error('Anime unavailable')
            return anime.api
        },
        window
    }
    vm.runInNewContext(settingsModsVisualSource, context, { filename: 'squad-arcade-settings-mods.js' })
    return {
        anime,
        document,
        documentListeners,
        doneButton,
        dropButton,
        dropin,
        elements,
        flushFrames(){
            const queued = [...frames.values()]
            frames.clear()
            queued.forEach(callback => callback())
        },
        frames,
        liveRegion,
        motionPreference,
        observers,
        off,
        optional,
        optionalContent,
        optionalSubmod,
        required,
        root,
        shaderButton,
        shaderOptions,
        shaderSelected,
        switchButton,
        tab,
        window,
        windowListeners,
        zip,
        createCard
    }
}

function renderObserverFor(harness){
    return harness.observers.find(observer => observer.observations.some(observation => observation.options.childList))
}

function lifecycleObserverFor(harness){
    return harness.observers.find(observer => observer.observations.some(observation => observation.options.attributeFilter?.includes('class')))
}

function assertModsMotionStylesClean(harness, message){
    const targets = [...new Set(harness.anime.calls.animations.flatMap(call => call.targets))]
    targets.forEach(target => {
        assert.equal(target.style.opacity, '', `${message}: opacity`)
        assert.equal(target.style.transform, '', `${message}: transform`)
    })
}

function testModsAdapterInitialization(){
    const valid = createModsAdapterHarness()
    assert.equal(valid.tab.classList.contains('is-squad-mods-ready'), true)
    assert.deepEqual(Object.keys(valid.window.squadArcadeSettingsMods), ['refresh', 'destroy'])
    assert.equal(valid.observers.length, 2)
    assert.equal(valid.liveRegion.textContent, 'Rack de equipamiento preparado.')
    const listenerCounts = [valid.tab, valid.shaderSelected, valid.shaderOptions].map(element => [...element.listeners.values()].flat().length)
    assert.equal(valid.window.squadArcadeSettingsMods.refresh(), true)
    assert.deepEqual([valid.tab, valid.shaderSelected, valid.shaderOptions].map(element => [...element.listeners.values()].flat().length), listenerCounts)

    const missing = createModsAdapterHarness({ missingId: 'settingsShadersOptions' })
    assert.equal(missing.tab.classList.contains('is-squad-mods-ready'), false)
    assert.equal(missing.observers.length, 0)
    const legacy = createModsAdapterHarness({ serviceReady: false })
    assert.equal(legacy.tab.classList.contains('is-squad-mods-ready'), false)
    assert.equal(legacy.observers.length, 0)

    const invalidated = createModsAdapterHarness()
    invalidated.shaderOptions.parentNode.children = invalidated.shaderOptions.parentNode.children.filter(child => child !== invalidated.shaderOptions)
    renderObserverFor(invalidated).callback([{ addedNodes: [], type: 'childList' }])
    invalidated.flushFrames()
    assert.equal(invalidated.tab.classList.contains('is-squad-mods-ready'), false, 'losing an essential node restores legacy fallback')
}

function testModsRequiredAndOptionalAccessibility(){
    const harness = createModsAdapterHarness()
    assert.equal(harness.tab.querySelectorAll('label[reqmod]').length, 1)
    assert.equal(harness.required.input.checked, true)
    assert.equal(harness.required.input.disabled, true)
    assert.equal(harness.required.input.getAttribute('aria-disabled'), 'true')
    assert.equal(harness.required.input.getAttribute('tabindex'), '-1')
    assert.match(harness.required.input.getAttribute('aria-label'), /Core: REQUERIDO, Activado/)
    let requiredChanges = 0
    harness.required.input.onclick = () => { requiredChanges++ }
    harness.required.input.click()
    assert.equal(requiredChanges, 0)
    assert.equal(harness.required.input.checked, true)
    assert.equal(harness.required.input.hasAttribute('formod'), false, 'required parent receives no functional formod attribute')
    assert.equal(harness.optional.input.disabled, false)
    assert.equal(harness.optional.input.getAttribute('tabindex'), null)
    assert.match(harness.optional.input.getAttribute('aria-label'), /Minimap: Activado/)
    assert.equal(harness.optionalSubmod.input.disabled, false)
    assert.match(harness.optionalSubmod.input.getAttribute('aria-label'), /Telemetry: Desactivado/)

    const settingsModsContainer = {
        querySelectorAll(selector){
            const id = selector.match(/\[formod='([^']+)'\]/)?.[1]
            return [harness.optional.input, harness.optionalSubmod.input].filter(input => input.getAttribute('formod') === id)
        }
    }
    const sut = loadFunctions(settingsSource, ['_saveModConfiguration'], { settingsModsContainer })
    const config = { 'com.acme:minimap': true, 'com.acme:telemetry': false }
    assert.deepEqual(JSON.parse(JSON.stringify(sut._saveModConfiguration(config))), config)
    assert.doesNotMatch(settingsModsVisualSource, /(?:setManagedAttribute|setAttribute)\([^\n]*['"]formod['"]|removeAttribute\(['"]formod/)
    assert.doesNotMatch(settingsModsVisualSource, /\.checked\s*=(?!=)/, 'adapter never changes persisted checkbox state')
}

function testModsDropinAccessibility(){
    const harness = createModsAdapterHarness()
    assert.match(harness.dropin.input.getAttribute('aria-label'), /Archivo externo External: Desactivado/)
    assert.match(harness.dropin.remove.getAttribute('aria-label'), /Eliminar External inmediatamente/)
    assert.equal(harness.dropin.remove.getAttribute('remmod'), 'external.jar.disabled')
    harness.dropin.remove.click()
    assert.equal(harness.dropin.remove.legacyRemovals, 1, 'immediate legacy removal handler remains intact')
    assert.match(harness.dropButton.getAttribute('aria-label'), /Abrir carpeta.*acepta archivos arrastrados/)
    assert.equal(harness.dropButton.getAttribute('aria-describedby'), 'settingsDropinRefreshNote')
}

function testModsShaderAccessibility(){
    const harness = createModsAdapterHarness()
    assert.equal(harness.shaderSelected.getAttribute('role'), 'combobox')
    assert.equal(harness.shaderSelected.getAttribute('aria-haspopup'), 'listbox')
    assert.equal(harness.shaderOptions.getAttribute('role'), 'listbox')
    assert.equal(harness.off.getAttribute('role'), 'option')
    assert.equal(harness.off.getAttribute('value'), 'OFF')
    assert.equal(harness.off.getAttribute('aria-selected'), 'true')
    assert.equal(harness.off.getAttribute('aria-label'), 'Shaders desactivados')
    const open = harness.shaderSelected.dispatch('keydown', { key: 'ArrowDown' })
    assert.equal(open.defaultPrevented, true)
    assert.equal(harness.shaderSelected.legacyClicks, 1, 'combobox keyboard delegates to legacy click')
    assert.equal(harness.off.focusCalls, 1)
    const select = harness.zip.dispatch('keydown', { key: 'Enter' })
    assert.equal(select.defaultPrevented, true)
    assert.equal(harness.zip.legacySelections, 1, 'option keyboard delegates to legacy click')
    assert.equal(harness.off.getAttribute('value'), 'OFF', 'OFF value remains untouched')
}

function testModsAdapterBoundaries(){
    const requiredModules = [...settingsModsVisualSource.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map(match => match[1])
    assert.deepEqual(requiredModules, ['animejs'])
    assert.doesNotMatch(settingsModsVisualSource, /prepareModsTab|reloadDropinMods|saveModConfiguration|saveDropinModConfiguration|saveShaderpackSettings/)
    assert.doesNotMatch(settingsModsVisualSource, /showOpenDialog|showMessageBox|confirm\s*\(|\bfetch\s*\(|XMLHttpRequest|ipcRenderer|\bshell\b|\bfs\b|ConfigManager|ProcessBuilder/)
    assert.doesNotMatch(settingsModsVisualSource, /removeAttribute\(['"](?:formod|dropin|remmod|reqmod|enabled|value|selected)['"]\)/)
    assert.match(settingsMarkup, /squad-arcade-settings\.js"><\/script>\s*<script src="\.\/assets\/js\/scripts\/squad-arcade-settings-mods\.js"><\/script>/)
}

function testModsMutationBatching(){
    const harness = createModsAdapterHarness()
    harness.anime.calls.animations[0].animation.complete()
    const newRow = harness.createCard('com.acme:new', 'New Mod', { checked: true, enabled: true })
    harness.optionalContent.appendChild(newRow.card)
    const observer = renderObserverFor(harness)
    const mutation = { addedNodes: [newRow.card], type: 'childList' }
    observer.callback([mutation])
    observer.callback([mutation])
    observer.callback([{ addedNodes: [], type: 'attributes' }])
    assert.equal(harness.frames.size, 1, 'mutation bursts schedule one frame')
    harness.flushFrames()
    assert.equal(harness.anime.calls.animations.length, 2)
    assert.deepEqual(harness.anime.calls.animations[1].targets, [newRow.card])
    observer.callback([{ addedNodes: [], type: 'attributes' }])
    harness.flushFrames()
    assert.equal(harness.anime.calls.animations.length, 2, 'idempotent enhancement never reanimates existing rows')
    assert.equal(harness.shaderSelected.listeners.get('keydown').length, 1)
    assert.equal(harness.shaderOptions.listeners.get('keydown').length, 1)
}

function testModsMotionFallbacksAndDrag(){
    const animated = createModsAdapterHarness()
    assert.equal(animated.anime.calls.animations.length, 1)
    assert.equal(animated.anime.calls.animations[0].parameters.duration, 190)
    assert.equal(animated.anime.calls.animations[0].parameters.loop, undefined)
    assert.deepEqual(Object.keys(animated.anime.calls.animations[0].parameters).filter(key => ['opacity', 'y'].includes(key)), ['opacity', 'y'])

    const absent = createModsAdapterHarness({ animeAvailable: false })
    assert.equal(absent.tab.classList.contains('is-squad-mods-ready'), true)
    assert.equal(absent.anime.calls.animations.length, 0)
    const reduced = createModsAdapterHarness({ reducedMotion: true })
    assert.equal(reduced.tab.classList.contains('is-squad-mods-ready'), true)
    assert.equal(reduced.anime.calls.animations.length, 0)
    const failed = createModsAdapterHarness({ animeFails: true })
    assert.equal(failed.tab.classList.contains('is-squad-mods-ready'), true)
    assertModsMotionStylesClean(failed, 'failed Anime initialization')

    const deferred = createModsAdapterHarness({ modsVisible: false })
    assert.equal(deferred.anime.calls.animations.length, 0)
    deferred.tab.style.display = 'flex'
    deferred.tab.setAttribute('aria-hidden', 'false')
    lifecycleObserverFor(deferred).callback([{ target: deferred.tab }])
    deferred.flushFrames()
    assert.equal(deferred.anime.calls.animations.length, 1, 'rows rendered while hidden enter once when Mods opens')

    const interaction = createModsAdapterHarness()
    interaction.tab.dispatch('change', { target: interaction.optional.input })
    interaction.tab.dispatch('input', { target: interaction.optional.input })
    interaction.tab.dispatch('scroll')
    interaction.doneButton.click()
    assert.equal(interaction.anime.calls.reverted, 1)
    assert.equal(interaction.anime.calls.animations.length, 1, 'input, change, scroll, and save never create motion')

    const dragging = createModsAdapterHarness()
    dragging.dropButton.dispatch('dragenter')
    const row = dragging.createCard('com.acme:drop', 'Dropped Mod')
    dragging.optionalContent.appendChild(row.card)
    renderObserverFor(dragging).callback([{ addedNodes: [row.card], type: 'childList' }])
    dragging.dropButton.dispatch('drop')
    dragging.flushFrames()
    assert.equal(dragging.anime.calls.animations.length, 1, 'drop-triggered rerender is not animated')
    renderObserverFor(dragging).callback([{ addedNodes: [row.card], type: 'childList' }])
    dragging.flushFrames()
    assert.equal(dragging.anime.calls.animations.length, 1, 'dropped rows never animate in a later batch')
}

function testModsMotionLifecycle(){
    const rerender = createModsAdapterHarness()
    const row = rerender.createCard('com.acme:rerender', 'Rerendered Mod')
    rerender.optionalContent.appendChild(row.card)
    renderObserverFor(rerender).callback([{ addedNodes: [row.card], type: 'childList' }])
    rerender.flushFrames()
    assert.equal(rerender.anime.calls.reverted, 1, 'rerender reverts active entrance before replacement')
    assertModsMotionStylesClean({ anime: { calls: { animations: [rerender.anime.calls.animations[0]] } } }, 'replaced entrance')

    const blurred = createModsAdapterHarness()
    blurred.windowListeners.get('blur')()
    assert.equal(blurred.anime.calls.reverted, 1)
    assertModsMotionStylesClean(blurred, 'blur cleanup')
    const hidden = createModsAdapterHarness()
    hidden.document.hidden = true
    hidden.documentListeners.get('visibilitychange')()
    assert.equal(hidden.anime.calls.reverted, 1)
    assertModsMotionStylesClean(hidden, 'hidden cleanup')
    const reduced = createModsAdapterHarness()
    reduced.motionPreference.listener({ matches: true })
    assert.equal(reduced.anime.calls.reverted, 1)
    assertModsMotionStylesClean(reduced, 'reduced-motion cleanup')
    const cancelled = createModsAdapterHarness({ animeSupportsRevert: false })
    cancelled.windowListeners.get('blur')()
    assert.equal(cancelled.anime.calls.cancelled, 1)
    assertModsMotionStylesClean(cancelled, 'cancel fallback cleanup')

    const exited = createModsAdapterHarness()
    exited.tab.setAttribute('aria-hidden', 'true')
    lifecycleObserverFor(exited).callback([{ target: exited.tab }])
    assert.equal(exited.anime.calls.reverted, 1, 'leaving the Mods tab reverts motion')
    const destroyed = createModsAdapterHarness()
    destroyed.window.squadArcadeSettingsMods.destroy()
    destroyed.window.squadArcadeSettingsMods.destroy()
    assert.equal(destroyed.tab.classList.contains('is-squad-mods-ready'), false)
    assert.equal(destroyed.required.input.disabled, false)
    assert.equal(destroyed.required.input.getAttribute('aria-disabled'), null)
    assert.equal(destroyed.observers.every(observer => observer.disconnected), true)
    assert.equal(destroyed.windowListeners.size, 0)
    assert.equal(destroyed.documentListeners.size, 0)
    assertModsMotionStylesClean(destroyed, 'destroy cleanup')
}

function testRecursiveModRendering(){
    const modules = createModFixture()
    const configuration = currentModConfiguration(modules)
    const sut = loadFunctions(settingsSource, ['parseModulesForUI'], {
        Type: { FabricMod: 'fabric', ForgeMod: 'forge', LiteLoader: 'liteloader', LiteMod: 'litemod' }
    })
    const rendered = sut.parseModulesForUI(modules, false, configuration.mods)

    assert.match(rendered.reqMods, /id="com\.acme:core" class="settingsBaseMod settingsMod" enabled/)
    assert.match(rendered.reqMods, /id="com\.acme:core-api" class="settingsBaseMod settingsSubMod" enabled/)
    assert.match(rendered.reqMods, /<label class="toggleSwitch" reqmod>/)
    assert.match(rendered.reqMods, /id="com\.acme:telemetry" class="settingsBaseMod settingsSubMod" >/)
    assert.match(rendered.optMods, /id="com\.acme:minimap" class="settingsBaseMod settingsMod" enabled/)
    assert.match(rendered.optMods, /formod="com\.acme:waypoints" checked/)
    assert.match(rendered.optMods, /id="com\.acme:voice" class="settingsBaseMod settingsMod" >/)
    assert.match(`${rendered.reqMods}${rendered.optMods}`, /class="settingsSubModContainer"/)
    assert.doesNotMatch(`${rendered.reqMods}${rendered.optMods}`, /id="[^"\r\n]+:[^"\r\n]+:[0-9]/, 'rendered IDs remain versionless')
}

function testCurrentModConfiguration(){
    const configuration = currentModConfiguration(createModFixture())
    assert.deepEqual(configuration, {
        mods: {
            'com.acme:core': { mods: { 'com.acme:telemetry': false } },
            'com.acme:minimap': { mods: { 'com.acme:waypoints': true }, value: true },
            'com.acme:voice': false
        }
    })
    assert.match(extractFunction(settingsSource, '_saveModConfiguration'), /tSwitch\[0\]\.hasAttribute\('dropin'\)/, 'required parents with optional submods remain coupled to a missing formod switch')
}

function testModConfigurationRoundTrip(){
    const configuration = {
        'com.acme:minimap': { mods: { 'com.acme:waypoints': true }, value: true },
        'com.acme:voice': false
    }
    const switches = new Map([
        ['com.acme:telemetry', false],
        ['com.acme:minimap', true],
        ['com.acme:waypoints', true],
        ['com.acme:voice', false]
    ].map(([id, checked]) => {
        const element = new FakeElement({ tagName: 'INPUT', type: 'checkbox' })
        element.checked = checked
        element.setAttribute('formod', id)
        return [id, element]
    }))
    const selectors = []
    const settingsModsContainer = {
        querySelectorAll(selector){
            selectors.push(selector)
            const id = selector.match(/\[formod='([^']+)'\]/)?.[1]
            return id != null && switches.has(id) ? [switches.get(id)] : []
        }
    }
    const sut = loadFunctions(settingsSource, ['_saveModConfiguration'], { settingsModsContainer })
    const saved = JSON.parse(JSON.stringify(sut._saveModConfiguration(configuration)))

    assert.deepEqual(saved, {
        'com.acme:minimap': { mods: { 'com.acme:waypoints': true }, value: true },
        'com.acme:voice': false
    })
    assert.equal(typeof saved['com.acme:voice'], 'boolean')
    assert.equal(typeof saved['com.acme:minimap'], 'object')
    assert.equal(typeof saved['com.acme:minimap'].value, 'boolean')
    assert.equal(typeof saved['com.acme:minimap'].mods, 'object')
    assert.equal(selectors.every(selector => !/:\d/.test(selector)), true, 'save queries versionless IDs')
}

async function testPrepareModsTabOrder(){
    const calls = []
    const asyncStub = name => async () => { calls.push(name) }
    const syncStub = name => () => { calls.push(name) }
    const sut = loadFunctions(settingsSource, ['prepareModsTab'], {
        resolveModsForUI: asyncStub('mods'),
        resolveDropinModsForUI: asyncStub('drop-ins'),
        resolveShaderpacksForUI: asyncStub('shaders'),
        bindDropinModsRemoveButton: syncStub('bind-remove'),
        bindDropinModFileSystemButton: syncStub('bind-folder'),
        bindShaderpackButton: syncStub('bind-shaders'),
        bindModsToggleSwitch: syncStub('bind-toggles'),
        loadSelectedServerOnModsTab: asyncStub('server')
    })
    await sut.prepareModsTab()
    assert.deepEqual(calls, ['mods', 'drop-ins', 'shaders', 'bind-remove', 'bind-folder', 'bind-shaders', 'bind-toggles', 'server'])
}

function testDropinScanContract(){
    const modsDir = path.join('C:', 'instances', 'alpha', 'mods')
    const versionDir = path.join(modsDir, '1.20.1')
    const directories = new Map([
        [modsDir, ['root.jar', 'archive.zip.disabled', 'legacy.litemod', 'upper.JAR', 'wrong.jar.DISABLED', 'notes.txt', '1.20.1']],
        [versionDir, ['versioned.jar.disabled', 'pack.zip', 'ignored.dll']]
    ])
    const util = loadDropinModUtil({
        existsSync: file => directories.has(file),
        readdirSync: file => directories.get(file),
        ensureDirSync(){ throw new Error('Unexpected filesystem write') }
    })
    const found = JSON.parse(JSON.stringify(util.scanForDropinMods(modsDir, '1.20.1')))
    assert.deepEqual(found, [
        { disabled: false, ext: 'jar', fullName: 'root.jar', name: 'root.jar' },
        { disabled: true, ext: 'zip', fullName: 'archive.zip.disabled', name: 'archive.zip' },
        { disabled: false, ext: 'litemod', fullName: 'legacy.litemod', name: 'legacy.litemod' },
        { disabled: true, ext: 'jar', fullName: path.join('1.20.1', 'versioned.jar.disabled'), name: 'versioned.jar' },
        { disabled: false, ext: 'zip', fullName: path.join('1.20.1', 'pack.zip'), name: 'pack.zip' }
    ])
}

async function testDropinToggleAndSave(){
    const renames = []
    const util = loadDropinModUtil({
        rename(from, to, callback){ renames.push([from, to]); callback(null) }
    })
    const enabledCard = new FakeElement({ id: 'enabled.jar' })
    enabledCard.setAttribute('enabled', '')
    const disabledCard = new FakeElement({ id: 'disabled.jar.disabled' })
    const enabledToggle = new FakeElement({ tagName: 'INPUT', type: 'checkbox' })
    enabledToggle.checked = false
    enabledToggle.setAttribute('formod', 'enabled.jar')
    const disabledToggle = new FakeElement({ tagName: 'INPUT', type: 'checkbox' })
    disabledToggle.checked = true
    disabledToggle.setAttribute('formod', 'disabled.jar.disabled')
    const cards = new Map([[enabledCard.id, enabledCard], [disabledCard.id, disabledCard]])
    const settingsModsContainer = {
        querySelectorAll(selector){ return selector === '[formod]' ? [enabledToggle, disabledToggle] : [] }
    }
    const document = { getElementById: id => cards.get(id) || null }
    const prelude = `const CACHE_SETTINGS_MODS_DIR = ${JSON.stringify(path.join('C:', 'mods'))}; const CACHE_DROPIN_MODS = [{ fullName: 'enabled.jar' }, { fullName: 'disabled.jar.disabled' }]`
    const sut = loadFunctions(settingsSource, ['bindModsToggleSwitch', 'saveDropinModConfiguration'], {
        document,
        DropinModUtil: util,
        isOverlayVisible(){ return false },
        Lang: blockedBoundary('language overlay'),
        setOverlayContent(){ throw new Error('Unexpected overlay') },
        setOverlayHandler(){ throw new Error('Unexpected overlay') },
        settingsModsContainer,
        toggleOverlay(){ throw new Error('Unexpected overlay') }
    }, prelude)

    sut.bindModsToggleSwitch()
    enabledToggle.onchange()
    disabledToggle.onchange()
    assert.equal(enabledCard.hasAttribute('enabled'), false)
    assert.equal(disabledCard.hasAttribute('enabled'), true)
    sut.saveDropinModConfiguration()
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(renames, [
        [path.join('C:', 'mods', 'enabled.jar'), path.join('C:', 'mods', 'enabled.jar.disabled')],
        [path.join('C:', 'mods', 'disabled.jar.disabled'), path.join('C:', 'mods', 'disabled.jar')]
    ])
}

async function testDropinFolderAndDragContract(){
    const button = new FakeElement({ id: 'settingsDropinFileSystemButton', tagName: 'BUTTON' })
    const calls = []
    const document = { getElementById: id => id === button.id ? button : null }
    const sut = loadFunctions(settingsSource, ['bindDropinModFileSystemButton', 'reloadDropinMods'], {
        bindDropinModsRemoveButton(){ calls.push('bind-remove') },
        bindDropinModFileSystemButton(){ calls.push('bind-folder') },
        bindModsToggleSwitch(){ calls.push('bind-toggles') },
        document,
        DropinModUtil: {
            addDropinMods(files, dir){ calls.push(['add', [...files], dir]) },
            validateDir(dir){ calls.push(['validate', dir]) }
        },
        resolveDropinModsForUI: async () => { calls.push('resolve') },
        shell: { openPath(dir){ calls.push(['openPath', dir]) } }
    }, `const CACHE_SETTINGS_MODS_DIR = ${JSON.stringify(path.join('C:', 'mods'))}`)

    sut.bindDropinModFileSystemButton()
    button.onclick()
    const dragEnter = { dataTransfer: {}, preventDefault(){ this.prevented = true } }
    button.ondragenter(dragEnter)
    assert.equal(button.hasAttribute('drag'), true)
    assert.equal(dragEnter.dataTransfer.dropEffect, 'move')
    assert.equal(dragEnter.prevented, true)
    button.ondragleave({})
    assert.equal(button.hasAttribute('drag'), false)
    const initialClickHandler = button.onclick
    const drop = { dataTransfer: { files: [{ name: 'new.jar' }] }, preventDefault(){ this.prevented = true } }
    await button.ondrop(drop)
    assert.equal(drop.prevented, true)
    assert.equal(button.hasAttribute('drag'), false)
    assert.notEqual(button.onclick, initialClickHandler, 'reload rebinds the existing folder button')
    assert.deepEqual(calls, [
        ['validate', path.join('C:', 'mods')],
        ['openPath', path.join('C:', 'mods')],
        ['add', [{ name: 'new.jar' }], path.join('C:', 'mods')],
        'resolve',
        'bind-remove',
        'bind-toggles'
    ])
    assert.doesNotMatch(extractFunction(settingsSource, 'bindDropinModFileSystemButton'), /showOpenDialog|dialog\.|file.?picker/i)
}

async function testImmediateTrashContract(){
    const invocations = []
    const errors = []
    let beeped = 0
    const responses = [
        { result: true },
        { error: 'locked', result: false }
    ]
    const util = loadDropinModUtil({}, {
        ipcRenderer: { invoke(...args){ invocations.push(args); return Promise.resolve(responses.shift()) } },
        shell: { beep(){ beeped++ } }
    }, { error(...args){ errors.push(args) }, warn(){}, log(){} })
    assert.equal(await util.deleteDropinMod(path.join('C:', 'mods'), 'ok.jar'), true)
    assert.equal(await util.deleteDropinMod(path.join('C:', 'mods'), 'bad.jar'), false)
    assert.deepEqual(invocations, [
        ['trash-item', path.join('C:', 'mods', 'ok.jar')],
        ['trash-item', path.join('C:', 'mods', 'bad.jar')]
    ])
    assert.equal(beeped, 1)
    assert.deepEqual(errors, [['Error deleting drop-in mod.', 'locked']])

    const removeButton = new FakeElement({ tagName: 'BUTTON' })
    removeButton.setAttribute('remmod', 'ok.jar')
    const card = new FakeElement({ id: 'ok.jar' })
    const overlay = []
    const document = { getElementById: id => id === card.id ? card : null }
    const settingsModsContainer = { querySelectorAll: selector => selector === '[remmod]' ? [removeButton] : [] }
    const sut = loadFunctions(settingsSource, ['bindDropinModsRemoveButton'], {
        document,
        DropinModUtil: { deleteDropinMod: async () => true },
        Lang: blockedBoundary('language'),
        setOverlayContent(){ overlay.push('content') },
        setOverlayHandler(){ overlay.push('handler') },
        settingsModsContainer,
        toggleOverlay(){ overlay.push('toggle') }
    }, `const CACHE_SETTINGS_MODS_DIR = ${JSON.stringify(path.join('C:', 'mods'))}`)
    sut.bindDropinModsRemoveButton()
    await removeButton.onclick()
    assert.equal(card.removed, true)
    assert.deepEqual(overlay, [])
    assert.doesNotMatch(extractFunction(settingsSource, 'bindDropinModsRemoveButton'), /confirm|showMessageBox/i)

    const failedButton = new FakeElement({ tagName: 'BUTTON' })
    failedButton.setAttribute('remmod', 'bad.jar')
    settingsModsContainer.querySelectorAll = () => [failedButton]
    const failed = loadFunctions(settingsSource, ['bindDropinModsRemoveButton'], {
        document,
        DropinModUtil: { deleteDropinMod: async () => false },
        Lang: { queryJS(key){ return key } },
        setOverlayContent(){ overlay.push('content') },
        setOverlayHandler(){ overlay.push('handler') },
        settingsModsContainer,
        toggleOverlay(){ overlay.push('toggle') }
    }, `const CACHE_SETTINGS_MODS_DIR = ${JSON.stringify(path.join('C:', 'mods'))}`)
    failed.bindDropinModsRemoveButton()
    await failedButton.onclick()
    assert.deepEqual(overlay, ['content', 'handler', 'toggle'])
}

function testShaderpackFilesystemContract(){
    const instanceDir = path.join('C:', 'instances', 'alpha')
    const shaderDir = path.join(instanceDir, 'shaderpacks')
    const optionsFile = path.join(instanceDir, 'optionsshaders.txt')
    const files = new Map([[shaderDir, ['cinematic.zip', 'folder', 'UPPER.ZIP']]])
    const writes = []
    const fsStub = {
        ensureDirSync(){},
        existsSync(file){ return files.has(file) },
        readFileSync(file){ return files.get(file) },
        readdirSync(file){ return files.get(file) },
        writeFileSync(file, value, options){ writes.push([file, value, options]); files.set(file, value) }
    }
    const util = loadDropinModUtil(fsStub)
    assert.deepEqual(JSON.parse(JSON.stringify(util.scanForShaderpacks(instanceDir))), [
        { fullName: 'OFF', name: 'Off (Default)' },
        { fullName: 'cinematic.zip', name: 'cinematic' }
    ])
    assert.equal(util.getEnabledShaderpack(instanceDir), 'OFF')
    files.set(optionsFile, 'quality=high\nshaderPack=cinematic.zip\nshadow=true')
    assert.equal(util.getEnabledShaderpack(instanceDir), 'cinematic.zip')
    files.set(optionsFile, 'shaderPack=missing.zip')
    assert.equal(util.getEnabledShaderpack(instanceDir), 'missing.zip', 'missing selected ZIP is preserved without validating the pack list')
    util.setEnabledShaderpack(instanceDir, 'OFF')
    assert.equal(writes.at(-1)[1], 'shaderPack=OFF')
    files.delete(optionsFile)
    util.setEnabledShaderpack(instanceDir, 'cinematic.zip')
    assert.deepEqual(JSON.parse(JSON.stringify(writes.at(-1))), [optionsFile, 'shaderPack=cinematic.zip', { encoding: 'utf-8' }])
}

async function testServerCachesAndConcurrentRefresh(){
    let selectedServer = 'alpha'
    const content = new FakeElement({ id: 'settingsDropinModsContent' })
    const scans = []
    const document = { getElementById: id => id === content.id ? content : null }
    const distribution = {
        getServerById(id){ return { rawServer: { id, minecraftVersion: id === 'alpha' ? '1.20.1' : '1.21.0' } } }
    }
    const prelude = 'let CACHE_SETTINGS_MODS_DIR; let CACHE_DROPIN_MODS; globalThis.readCache = () => ({ dir: CACHE_SETTINGS_MODS_DIR, mods: CACHE_DROPIN_MODS })'
    const cacheSut = loadFunctions(settingsSource, ['resolveDropinModsForUI'], {
        ConfigManager: {
            getInstanceDirectory(){ return path.join('C:', 'instances') },
            getSelectedServer(){ return selectedServer }
        },
        DistroAPI: { async getDistribution(){ return distribution } },
        document,
        DropinModUtil: {
            scanForDropinMods(dir, version){ scans.push([dir, version]); return [{ disabled: false, fullName: `${selectedServer}.jar`, name: selectedServer }] }
        },
        Lang: { queryJS(){ return 'Remove' } },
        path
    }, prelude)
    await cacheSut.resolveDropinModsForUI()
    selectedServer = 'beta'
    await cacheSut.resolveDropinModsForUI()
    assert.deepEqual(scans, [
        [path.join('C:', 'instances', 'alpha', 'mods'), '1.20.1'],
        [path.join('C:', 'instances', 'beta', 'mods'), '1.21.0']
    ])
    assert.equal(cacheSut.context.readCache().dir, path.join('C:', 'instances', 'beta', 'mods'), 'module cache is last-refresh-wins')

    let prepareCalls = 0
    let fadeInCalls = 0
    const refreshSut = loadFunctions(settingsSource, ['animateSettingsTabRefresh'], {
        $(){
            return {
                fadeOut(_duration, callback){ callback() },
                fadeIn(){ fadeInCalls++ }
            }
        },
        async prepareSettings(){ prepareCalls++ }
    }, 'const selectedSettingsTab = \'settingsTabMods\'')
    refreshSut.animateSettingsTabRefresh()
    refreshSut.animateSettingsTabRefresh()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(prepareCalls, 2, 'concurrent refreshes are not deduplicated')
    assert.equal(fadeInCalls, 2)
}

function testProcessBuilderModContract(){
    const buildContract = extractFunction(processBuilderSource.replace('    build()', 'function build()'), 'build')
    const saveContract = extractFunction(settingsSource, '_saveModConfiguration')
    assert.match(buildContract, /getModConfiguration\(this\.server\.rawServer\.id\)\.mods/)
    assert.match(buildContract, /resolveModConfiguration\([^,]+, this\.server\.modules\)/)
    assert.match(processBuilderSource, /static isModEnabled\(modCfg, required = null\)\{\s*return modCfg != null \? \(\(typeof modCfg === 'boolean'/)
    assert.match(processBuilderSource, /typeof modCfg === 'object' && \(typeof modCfg\.value !== 'undefined' \? modCfg\.value : true\)/)
    assert.match(processBuilderSource, /modCfg\[mdl\.getVersionlessMavenIdentifier\(\)\]/)
    assert.match(saveContract, /typeof m\[1\] === 'boolean'/)
    assert.match(saveContract, /modConf\[m\[0\]\]\.value/)
    assert.match(saveContract, /modConf\[m\[0\]\]\.mods/)
}

function testModsIsolationBoundaries(){
    const guardedFs = blockedBoundary('filesystem')
    assert.throws(() => loadDropinModUtil(guardedFs).scanForDropinMods('mods', '1.20.1'), /Unexpected filesystem access/)
    assert.throws(() => loadDropinModUtil({}, blockedBoundary('Electron')), /Unexpected Electron access/)
    const dropinRequires = [...dropinModUtilSource.matchAll(/require\('([^']+)'\)/g)].map(match => match[1])
    assert.deepEqual(dropinRequires, ['fs-extra', 'path', 'electron', './ipcconstants'])
    assert.doesNotMatch(extractFunction(settingsSource, 'bindDropinModFileSystemButton'), /require\s*\(|fetch\s*\(|ipcRenderer/)
    assert.doesNotMatch(extractFunction(settingsSource, 'bindDropinModsRemoveButton'), /require\s*\(|fetch\s*\(|shell\./)
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
    await scenario('updater checking, notification, install, and error contracts', testUpdaterRuntimeContract)
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
    await scenario('Mods exposes the 16-ID contractual snapshot', testModsContractSnapshot)
    await scenario('equipment rack hooks preserve the Mods DOM contract', testEquipmentRackMarkupContract)
    await scenario('equipment rack stylesheet loads after Service Bay and stays namespaced', testEquipmentRackStylesheetContract)
    await scenario('equipment rack keeps responsive columns, transparency, and one scroll owner', testEquipmentRackLayoutContract)
    await scenario('equipment rack preserves legacy controls and adds no capabilities', testEquipmentRackInteractionBoundaries)
    await scenario('Mods adapter initializes idempotently and fails back on incomplete shells', testModsAdapterInitialization)
    await scenario('required locks preserve checked state while optional controls stay interactive', testModsRequiredAndOptionalAccessibility)
    await scenario('drop-in accessibility preserves disabled state and immediate removal', testModsDropinAccessibility)
    await scenario('shader ARIA and keyboard delegate to legacy click with OFF intact', testModsShaderAccessibility)
    await scenario('Mods adapter has no persistence or external side effects', testModsAdapterBoundaries)
    await scenario('Mods mutation bursts batch without listener or animation accumulation', testModsMutationBatching)
    await scenario('Mods motion is finite and respects absence, reduced motion, and drag', testModsMotionFallbacksAndDrag)
    await scenario('Mods motion rerender and lifecycle cleanup leave no inline styles', testModsMotionLifecycle)
    await scenario('required, optional, and nested distro modules render recursively', testRecursiveModRendering)
    await scenario('required defaults and submods generate the current configuration', testCurrentModConfiguration)
    await scenario('mod configuration round-trip preserves shapes and versionless IDs', testModConfigurationRoundTrip)
    await scenario('prepareModsTab keeps the exact resolve and bind order', testPrepareModsTabOrder)
    await scenario('drop-in scan covers root, version folder, extensions, and disabled case', testDropinScanContract)
    await scenario('drop-in toggles mirror enabled and save through rename stubs', testDropinToggleAndSave)
    await scenario('drop-in folder click, drag lifecycle, reload, and rebind remain intact', testDropinFolderAndDragContract)
    await scenario('drop-in trash IPC remains immediate with success and error behavior', testImmediateTrashContract)
    await scenario('shader OFF, selected, missing, read, and write behavior remains intact', testShaderpackFilesystemContract)
    await scenario('server caches are last-refresh-wins and concurrent refreshes persist', testServerCachesAndConcurrentRefresh)
    await scenario('ProcessBuilder consumes boolean and object mod configuration shapes', testProcessBuilderModContract)
    await scenario('Mods side effects remain isolated behind fail-closed stubs', testModsIsolationBoundaries)
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

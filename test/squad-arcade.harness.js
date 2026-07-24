const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'assets', 'js', 'scripts', 'squad-arcade.js'), 'utf8')
const landingSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'assets', 'js', 'scripts', 'landing.js'), 'utf8')
const landingMarkup = fs.readFileSync(path.join(__dirname, '..', 'app', 'landing.ejs'), 'utf8')
const launcherStyles = fs.readFileSync(path.join(__dirname, '..', 'app', 'assets', 'css', 'launcher.css'), 'utf8')
const localeSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'assets', 'lang', 'en_US.toml'), 'utf8')
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'legacy-characterization.json'), 'utf8'))

class FakeClassList {
    toggle(){ }
}

class FakeElement {
    constructor(dataset = {}){
        this.dataset = dataset
        this.attributes = new Map()
        this.classList = new FakeClassList()
        this.listeners = new Map()
        this.style = { width: '', setProperty(){} }
        this.textContent = ''
        this.disabled = false
        this.hidden = false
        this.parentElement = null
        this.clickCalls = 0
    }

    addEventListener(type, listener){
        const listeners = this.listeners.get(type) || []
        listeners.push(listener)
        this.listeners.set(type, listeners)
    }

    dispatch(type, event = {}){
        this.listeners.get(type)?.forEach(listener => listener({ target: this, preventDefault(){}, ...event }))
    }

    setAttribute(name, value){
        this.attributes.set(name, String(value))
    }

    getAttribute(name){
        return this.attributes.get(name) ?? null
    }

    removeAttribute(name){
        this.attributes.delete(name)
        if(name === 'src'){
            this.src = ''
        }
    }

    toggleAttribute(name, force){
        if(force){
            this.attributes.set(name, '')
        } else {
            this.attributes.delete(name)
        }
    }

    hasAttribute(name){
        return this.attributes.has(name)
    }

    showModal(){
        this.attributes.set('open', '')
    }

    close(){
        this.attributes.delete('open')
        this.dispatch('close')
    }

    focus(){ }
    click(){
        if(this.disabled){
            return
        }
        this.clickCalls++
        this.dispatch('click')
    }
}

function createAnimeStub(){
    const calls = { animate: [], timelines: [], cancelled: 0, completed: 0 }
    const createInstance = parameters => ({
        cancel(){
            calls.cancelled += 1
        },
        complete(){
            calls.completed += 1
            parameters?.onComplete?.()
        }
    })
    return {
        calls,
        api: {
            animate(targets, parameters){
                calls.animate.push({ targets, parameters })
                return createInstance(parameters)
            },
            createTimeline(parameters){
                const timeline = createInstance(parameters)
                timeline.steps = []
                timeline.add = (targets, stepParameters, position) => {
                    timeline.steps.push({ targets, parameters: stepParameters, position })
                    return timeline
                }
                calls.timelines.push(timeline)
                return timeline
            },
            stagger(value){
                return value
            }
        }
    }
}

function createHarness({ animeAvailable = true, launchEntry = null, launchProgress = null, launchState = null, reducedMotion = false, serverSelectionAvailable = true } = {}){
    const root = new FakeElement({ theme: 'overworld' })
    const landing = new FakeElement()
    root.parentElement = landing
    const elements = {
        '[data-sa-play]': new FakeElement(),
        '[data-sa-play-ready-detail]': new FakeElement(),
        '[data-sa-play-detail]': new FakeElement(),
        '[data-sa-progress]': new FakeElement(),
        '[data-sa-progress-label]': new FakeElement(),
        '[data-sa-progress-track]': new FakeElement(),
        '[data-sa-live]': new FakeElement(),
        '[data-sa-theme-dialog]': new FakeElement(),
        '[data-sa-theme-trigger]': new FakeElement(),
        '[data-sa-select-server]': new FakeElement(),
        '[data-sa-youtube]': new FakeElement(),
        '[data-sa-server-icon]': new FakeElement(),
        '[data-sa-skin]': new FakeElement(),
        '.sa-marquee': new FakeElement(),
        '.sa-cartridge': new FakeElement(),
        '.sa-server-icon-stage': new FakeElement(),
        '.sa-server-copy': new FakeElement(),
        '.sa-player': new FakeElement(),
        '.sa-footer': new FakeElement(),
        '.sa-theme-pulse': new FakeElement(),
        '.sa-play-icon': new FakeElement(),
        '.sa-play-copy': new FakeElement(),
        '.sa-play-energy': new FakeElement(),
        '.sa-play-sheen': new FakeElement(),
        '.sa-play-shockwave': new FakeElement(),
        '.sa-progress-scan': new FakeElement()
    }
    const textSelectors = [
        '[data-sa-server-id]',
        '[data-sa-server-name]',
        '[data-sa-server-description]',
        '[data-sa-minecraft-version]',
        '[data-sa-pack-version]',
        '[data-sa-account-name]',
        '[data-sa-status]',
        '[data-sa-players]'
    ]
    textSelectors.forEach(selector => {
        elements[selector] = new FakeElement()
    })
    elements['[data-sa-youtube]'].setAttribute('href', '#')
    const themes = ['overworld', 'creeper', 'nether', 'ender'].map(theme => new FakeElement({ saTheme: theme }))
    const openButtons = [
        new FakeElement({ saOpen: 'settings' }),
        new FakeElement({ saOpen: 'account' }),
        new FakeElement({ saOpen: 'mods' })
    ]
    const groups = {
        '[data-sa-theme]': themes,
        '[data-sa-theme-close]': [new FakeElement()],
        '[data-sa-open]': openButtons,
        '.sa-brand, .sa-marquee nav button, .sa-theme-trigger': [new FakeElement(), new FakeElement()],
        '.sa-actions > button': [elements['[data-sa-play]'], new FakeElement(), new FakeElement()],
        '.sa-server-meta span': [new FakeElement(), new FakeElement(), new FakeElement(), new FakeElement()]
    }
    root.querySelector = selector => {
        const themeMatch = selector.match(/^\[data-sa-theme='([^']+)'\]$/)
        return themeMatch ? themes.find(option => option.dataset.saTheme === themeMatch[1]) : elements[selector] || null
    }
    root.querySelectorAll = selector => groups[selector] || []

    const motionPreference = {
        matches: reducedMotion,
        addEventListener(_type, listener){
            this.listener = listener
        }
    }
    const timers = new Map()
    const windowListeners = new Map()
    const documentListeners = new Map()
    let timerId = 0
    const anime = createAnimeStub()
    const actionCalls = []
    const config = {
        theme: 'overworld',
        getLauncherTheme(){ return this.theme },
        setLauncherTheme(theme){ this.theme = theme },
        save(){},
        getSelectedAccount(){ return null },
        getSelectedServer(){ return 'alpha' }
    }
    const server = id => ({ rawServer: { id, name: `Server ${id}`, description: 'Description', minecraftVersion: '1.21', version: '2.0', icon: `${id}.png` } })
    const navElements = {
        settingsNavAccount: new FakeElement(),
        settingsNavMods: new FakeElement()
    }
    navElements.settingsNavAccount.id = 'settingsNavAccount'
    navElements.settingsNavMods.id = 'settingsNavMods'
    const document = {
        hidden: false,
        querySelector(selector){ return selector === '[data-squad-arcade]' ? root : null },
        getElementById(id){ return navElements[id] || null },
        addEventListener(type, listener){ documentListeners.set(type, listener) }
    }
    const window = {
        launchGame: launchEntry,
        matchMedia: () => motionPreference,
        addEventListener(type, listener){ windowListeners.set(type, listener) },
        setTimeout(listener){
            const id = ++timerId
            timers.set(id, () => {
                timers.delete(id)
                listener()
            })
            return id
        },
        clearTimeout(id){ timers.delete(id) }
    }
    if(launchState != null){
        window.getLaunchState = () => ({ ...launchState })
    }
    if(launchProgress != null){
        window.getLaunchProgress = () => ({ ...launchProgress })
    }
    const context = {
        console,
        document,
        require(name){
            assert.equal(name, 'animejs')
            if(!animeAvailable){
                throw new Error('Anime unavailable')
            }
            return anime.api
        },
        window,
        ConfigManager: config,
        DistroAPI: { getDistribution: async () => ({ getServerById: () => server('alpha') }) },
        loggerLanding: { warn(){} },
        prepareSettings: async () => { actionCalls.push(['prepare']) },
        switchView(_from, to, _out, _in, onCurrentFade){
            actionCalls.push(['switch', to])
            onCurrentFade?.()
        },
        getCurrentView(){ return 'landing' },
        VIEWS: { landing: 'landing', settings: 'settings' },
        settingsNavItemListener(element, fade){ actionCalls.push(['tab', element.id, fade]) }
    }
    if(serverSelectionAvailable){
        context.toggleServerSelection = state => actionCalls.push(['server', state])
    }
    vm.runInNewContext(source, context, { filename: 'squad-arcade.js' })
    return { actionCalls, anime, api: context.window.squadArcade, document, documentListeners, elements, landing, motionPreference, openButtons, root, runtimeWindow: window, server, themes, timers, windowListeners }
}

async function run(){
    const installedAnime = require('animejs')
    assert.equal(require('animejs/package.json').version, '4.3.0')
    assert.equal(typeof installedAnime.animate, 'function')
    assert.equal(typeof installedAnime.createTimeline, 'function')
    assert.equal(typeof installedAnime.stagger, 'function')

    const animated = createHarness()
    await Promise.resolve()
    assert.ok(animated.api)
    assert.equal(animated.root.hidden, false)
    assert.equal(animated.landing.classList instanceof FakeClassList, true)
    assert.equal(animated.anime.calls.timelines.length, 1, 'initial entrance uses one timeline')

    animated.api.updateServer(animated.server('alpha'))
    animated.api.updateServer(animated.server('beta'))
    animated.api.updateServer(animated.server('beta'))
    assert.equal(animated.anime.calls.timelines.length, 2, 'server stamp only runs for a real ID change')

    const mirrors = createHarness({ reducedMotion: true })
    await Promise.resolve()
    mirrors.api.updateAccount({ displayName: 'Player One', uuid: 'account-1' })
    assert.equal(mirrors.elements['[data-sa-account-name]'].textContent, 'Player One')
    assert.equal(mirrors.elements['[data-sa-skin]'].src, 'https://mc-heads.net/body/account-1/right')
    assert.equal(mirrors.elements['[data-sa-skin]'].alt, 'Skin de Player One')
    assert.equal(mirrors.elements['[data-sa-skin]'].hidden, false)
    mirrors.api.updateAccount(null)
    assert.equal(mirrors.elements['[data-sa-account-name]'].textContent, 'Sin cuenta')
    assert.equal(mirrors.elements['[data-sa-skin]'].src, '')
    assert.equal(mirrors.elements['[data-sa-skin]'].alt, '')
    assert.equal(mirrors.elements['[data-sa-skin]'].hidden, true)

    mirrors.api.updateServer({ rawServer: { id: 'fallback', name: 'Fallback', description: '', minecraftVersion: '', version: '' } })
    assert.equal(mirrors.elements['[data-sa-server-icon]'].src, 'assets/images/SealCircle.png')
    assert.equal(mirrors.elements['[data-sa-server-icon]'].alt, 'Icono de Fallback')
    mirrors.api.updateServer(null)
    assert.equal(mirrors.elements['[data-sa-server-name]'].textContent, 'Sin servidor')
    assert.equal(mirrors.elements['[data-sa-server-icon]'].src, 'assets/images/SealCircle.png')
    assert.equal(mirrors.elements['[data-sa-server-icon]'].alt, '')

    mirrors.api.updateStatus(true, '3/20')
    assert.equal(mirrors.elements['[data-sa-status]'].textContent, 'ONLINE')
    assert.equal(mirrors.elements['[data-sa-players]'].textContent, '3/20')
    mirrors.api.updateStatus(false, 'offline')
    assert.equal(mirrors.elements['[data-sa-status]'].textContent, 'OFFLINE')
    assert.equal(mirrors.elements['[data-sa-players]'].textContent, '--')

    animated.themes[1].click()
    animated.themes[1].click()
    animated.themes[2].click()
    assert.equal(animated.anime.calls.animate.length, 4, 'theme pulse only runs when the theme changes')
    assert.equal(animated.anime.calls.cancelled, 2, 'a new theme pulse replaces both previous theme animations')

    assert.equal(animated.timers.size, 1, 'enabled play schedules one attraction cycle')
    const runAttraction = [...animated.timers.values()][0]
    runAttraction()
    assert.equal(animated.anime.calls.timelines.length, 3, 'attraction runs as one finite timeline')
    assert.equal(animated.timers.size, 1, 'attraction reschedules with one spaced timeout')

    let directLaunches = 0
    const direct = createHarness({
        launchEntry: () => { directLaunches++ },
        launchState: { enabled: true, launching: false }
    })
    await Promise.resolve()
    direct.elements['[data-sa-play]'].click()
    assert.equal(directLaunches, 1, 'visible Play uses the explicit launch entry exactly once')
    direct.api.setLaunching(true)
    direct.elements['[data-sa-play]'].click()
    assert.equal(directLaunches, 1, 'launching disables direct Play reentry')
    direct.api.setLaunching(false)
    direct.elements['[data-sa-play]'].click()
    assert.equal(directLaunches, 2, 'direct Play is available again after launch state clears')

    assert.doesNotThrow(() => animated.elements['[data-sa-play]'].click())
    animated.api.setLaunching(true)
    animated.elements['[data-sa-play]'].click()
    animated.api.setLaunching(false)
    animated.elements['[data-sa-play]'].click()
    assert.doesNotMatch(source, /launch_button|legacyLanding|setLegacyHidden/, 'Home has no legacy shell or launch fallback')

    animated.api.setLaunchPercentage(0)
    assert.equal(animated.elements['[data-sa-progress-label]'].textContent, '0%')
    animated.api.setLaunchPercentage(37)
    assert.equal(animated.elements['[data-sa-progress]'].style.width, '37%')
    assert.equal(animated.elements['[data-sa-progress-label]'].textContent, '37%')
    animated.api.setLaunchPercentage(100)
    assert.equal(animated.elements['[data-sa-progress-label]'].textContent, '100%')
    animated.api.setLaunchPercentage(140)
    assert.equal(animated.elements['[data-sa-progress-label]'].textContent, '100%', 'progress clamps above 100')
    animated.api.setLaunchPercentage(-20)
    assert.equal(animated.elements['[data-sa-progress-label]'].textContent, '0%', 'progress clamps below 0')

    const timelinesBeforeRepeatedLaunch = animated.anime.calls.timelines.length
    animated.api.setLaunching(true)
    animated.api.setLaunching(true)
    assert.equal(animated.root.hasAttribute('data-launching'), true)
    assert.equal(animated.elements['[data-sa-play]'].getAttribute('aria-busy'), 'true')
    assert.equal(animated.timers.size, 0, 'launching cancels the attraction timeout')
    assert.equal(animated.anime.calls.timelines.length, timelinesBeforeRepeatedLaunch + 1, 'launch reaction runs once per launch start')
    animated.api.setLaunchPercentage(37)
    assert.equal(animated.elements['[data-sa-progress-track]'].getAttribute('aria-valuenow'), '37')
    animated.api.setLaunching(false)
    assert.equal(animated.root.hasAttribute('data-launching'), false)
    assert.equal(animated.elements['[data-sa-play]'].getAttribute('aria-busy'), null)
    assert.equal(animated.elements['[data-sa-progress-label]'].textContent, '0%')
    assert.equal(animated.timers.size, 1, 'leaving launch restores the attraction cycle')

    const explicitState = createHarness({ launchState: { enabled: true, launching: false } })
    await Promise.resolve()
    assert.equal(explicitState.elements['[data-sa-play]'].disabled, false, 'Home initializes from explicit enabled state')
    explicitState.api.setLaunching(true)
    explicitState.api.setEnabled(true)
    assert.equal(explicitState.elements['[data-sa-play]'].disabled, true, 'enabled refresh cannot re-enable Home while launching')
    explicitState.api.setLaunching(false)
    assert.equal(explicitState.elements['[data-sa-play]'].disabled, false, 'launch reset restores direct Home when explicitly enabled')
    explicitState.api.setEnabled(false)
    explicitState.api.setLaunching(true)
    explicitState.api.setLaunching(false)
    assert.equal(explicitState.elements['[data-sa-play]'].disabled, true, 'launch reset preserves the explicit disabled state')

    const initiallyLaunching = createHarness({ launchState: { enabled: true, launching: true } })
    await Promise.resolve()
    assert.equal(initiallyLaunching.root.hasAttribute('data-launching'), true)
    assert.equal(initiallyLaunching.elements['[data-sa-play]'].disabled, true, 'Home initializes from explicit launching state')

    const initialProgress = createHarness({
        launchProgress: { details: 'Restoring progress', percent: 42 },
        launchState: { enabled: true, launching: true }
    })
    await Promise.resolve()
    assert.equal(initialProgress.elements['[data-sa-play-detail]'].textContent, 'Restoring progress')
    assert.equal(initialProgress.elements['[data-sa-progress-label]'].textContent, '42%', 'Home initializes from progress snapshot without legacy nodes')

    const stateCompatibility = createHarness()
    await Promise.resolve()
    assert.equal(stateCompatibility.elements['[data-sa-play]'].disabled, false, 'missing state API derives initial compatibility state from server data')

    const controls = createHarness()
    await Promise.resolve()
    const [settingsTrigger, accountTrigger] = controls.openButtons
    settingsTrigger.click()
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(controls.actionCalls.splice(0), [['prepare'], ['switch', 'settings']], 'Settings trigger opens Settings exactly once')
    accountTrigger.click()
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(controls.actionCalls.splice(0), [
        ['prepare'],
        ['switch', 'settings'],
        ['tab', 'settingsNavAccount', false]
    ], 'Account trigger opens the Account tab exactly once')
    controls.elements['[data-sa-select-server]'].click()
    assert.deepEqual(controls.actionCalls.splice(0), [['server', true]], 'Server trigger opens shared selection exactly once')

    const missingServerEntry = createHarness({ serverSelectionAvailable: false })
    await Promise.resolve()
    assert.doesNotThrow(() => missingServerEntry.elements['[data-sa-select-server]'].click())
    assert.deepEqual(missingServerEntry.actionCalls, [], 'Server trigger is inert before the shared overlay entrypoint loads')

    for(const retiredId of ['settingsMediaButton', 'avatarOverlay']){
        assert.doesNotMatch(landingMarkup, new RegExp(`id="${retiredId}"`), `${retiredId} stays retired from markup`)
        assert.doesNotMatch(landingSource, new RegExp(`['"]${retiredId}['"]`), `${retiredId} has no production binding`)
        assert.doesNotMatch(launcherStyles, new RegExp(`#${retiredId}\\b`), `${retiredId} has no dead style`)
    }
    const retiredMirrors = [
        'user_content',
        'user_text',
        'avatarContainer',
        'server_select_container',
        'server_selection_button',
        'server_thumbnail',
        'server_status_wrapper',
        'landingPlayerLabel',
        'player_count'
    ]
    retiredMirrors.forEach(id => {
        assert.doesNotMatch(landingMarkup, new RegExp(`id="${id}"`), `${id} stays retired from markup`)
        assert.doesNotMatch(landingSource, new RegExp(`['"]${id}['"]`), `${id} has no production sink`)
        assert.doesNotMatch(launcherStyles, new RegExp(`#${id}\\b`), `${id} has no dead style`)
    })
    const retiredMojangIds = [
        'mojangStatusWrapper',
        'mojang_status_icon',
        'mojangStatusTooltip',
        'mojangStatusTooltipTitle',
        'mojangStatusEssentialContainer',
        'mojangStatusNEContainer',
        'mojangStatusNETitle',
        'mojangStatusNonEssentialContainer'
    ]
    for(const retiredMojangId of retiredMojangIds){
        assert.doesNotMatch(landingMarkup, new RegExp(`id="${retiredMojangId}"`), `${retiredMojangId} stays retired from markup`)
        assert.doesNotMatch(landingSource, new RegExp(`['"]${retiredMojangId}['"]`), `${retiredMojangId} has no production binding`)
    }
    for(const retiredMojangSelector of [
        '#mojangStatusWrapper',
        '#mojang_status_icon',
        '#mojangStatusTooltip',
        '#mojangStatusTooltipTitle',
        '#mojangStatusNEContainer',
        '.mojangStatusNEBar',
        '#mojangStatusNETitle',
        '.mojangStatusContainer',
        '.mojangStatusName',
        '.mojangStatusIcon'
    ]){
        assert.doesNotMatch(launcherStyles, new RegExp(retiredMojangSelector.replace('.', '\\.')), `${retiredMojangSelector} has no dead style`)
    }
    for(const retiredStatusContract of [
        'refreshMojangStatuses',
        'mojangStatusListener',
        'MojangRestAPI.status',
        'MojangRestAPI.getDefaultStatuses',
        'MojangRestAPI.statusToHex'
    ]){
        assert.doesNotMatch(landingSource, new RegExp(retiredStatusContract.replace('.', '\\.')), `${retiredStatusContract} stays retired from landing runtime`)
    }
    for(const retiredLocaleKey of ['mojangStatus', 'mojangStatusTooltipTitle', 'mojangStatusNETitle']){
        assert.doesNotMatch(localeSource, new RegExp(`^${retiredLocaleKey}\\s*=`, 'm'), `${retiredLocaleKey} stays retired from locale`)
    }
    assert.match(landingMarkup, /data-sa-open="settings"/)
    assert.match(landingMarkup, /data-sa-open="account"/)
    assert.match(landingMarkup, /data-sa-select-server/)

    const doubleClick = createHarness()
    await Promise.resolve()
    const expectedDoubleClick = manifest.knownGaps.find(item => item.id === 'launch-double-click-window')
    assert.ok(expectedDoubleClick)
    let resolveDistribution
    let distributionRequests = 0
    let explicitLaunchCalls = 0
    const pendingDistribution = new Promise(resolve => { resolveDistribution = resolve })
    const launchBinding = landingSource.slice(landingSource.indexOf('// Expose the single launch entry'), landingSource.indexOf('// Bind selected account'))
    const launchContext = {
        document: doubleClick.document,
        window: doubleClick.runtimeWindow,
        DistroAPI: { getDistribution(){ distributionRequests++; return pendingDistribution } },
        ConfigManager: { getSelectedServer: () => 'alpha', getJavaExecutable: () => null },
        loggerLanding: { info(){}, error(){} },
        Lang: { queryJS: key => key },
        asyncSystemScan(){},
        showLaunchFailure(){},
        setLaunchDetails(){},
        setLaunchPercentage(){},
        toggleLaunchArea(value){ doubleClick.api.setLaunching(value) }
    }
    vm.runInNewContext(launchBinding, launchContext)
    const productLaunch = doubleClick.runtimeWindow.launchGame
    doubleClick.runtimeWindow.launchGame = (...args) => {
        explicitLaunchCalls++
        return productLaunch(...args)
    }
    doubleClick.elements['[data-sa-play]'].click()
    doubleClick.elements['[data-sa-play]'].click()
    assert.equal(doubleClick.elements['[data-sa-play]'].clickCalls, expectedDoubleClick.visiblePlayClicks)
    assert.equal(explicitLaunchCalls, expectedDoubleClick.explicitLaunchCalls)
    assert.equal(expectedDoubleClick.legacyLaunchClicks, 0)
    assert.equal(distributionRequests, expectedDoubleClick.distributionRequestsBeforeLaunching)
    assert.equal(doubleClick.root.hasAttribute('data-launching'), expectedDoubleClick.launchingBeforeDistributionResolves)
    resolveDistribution({ getServerById: () => ({ effectiveJavaOptions: { supported: [21] } }) })
    await pendingDistribution
    await Promise.resolve()

    const reduced = createHarness({ reducedMotion: true })
    await Promise.resolve()
    reduced.api.updateServer(reduced.server('beta'))
    reduced.themes[1].click()
    reduced.api.setLaunching(true)
    assert.equal(reduced.anime.calls.animate.length, 0)
    assert.equal(reduced.anime.calls.timelines.length, 0)
    assert.equal(reduced.timers.size, 0, 'reduced motion never schedules attraction')

    const toggledMotion = createHarness()
    await Promise.resolve()
    toggledMotion.api.updateServer(toggledMotion.server('alpha'))
    assert.equal(toggledMotion.timers.size, 1)
    toggledMotion.motionPreference.listener({ matches: true })
    assert.equal(toggledMotion.timers.size, 0, 'enabling reduced motion cancels attraction')

    const hidden = createHarness()
    await Promise.resolve()
    hidden.api.updateServer(hidden.server('alpha'))
    assert.equal(hidden.timers.size, 1)
    hidden.document.hidden = true
    hidden.documentListeners.get('visibilitychange')()
    assert.equal(hidden.timers.size, 0, 'hidden document cancels attraction')

    const unavailable = createHarness({ animeAvailable: false })
    await Promise.resolve()
    assert.doesNotThrow(() => {
        unavailable.api.updateServer(unavailable.server('beta'))
        unavailable.themes[1].click()
        unavailable.api.setLaunching(true)
        unavailable.api.setLaunching(false)
    })

    assert.equal(unavailable.timers.size, 0, 'Anime fallback does not schedule attraction')

    console.log('Squad Arcade harness: 26 scenarios passed')
}

run().catch(error => {
    console.error(error)
    process.exitCode = 1
})

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const projectRoot = path.join(__dirname, '..')
const introSource = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'js', 'scripts', 'welcome.js'), 'utf8')
const configSource = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'js', 'configmanager.js'), 'utf8')
const uiBinderSource = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'js', 'scripts', 'uibinder.js'), 'utf8')
const introMarkup = fs.readFileSync(path.join(projectRoot, 'app', 'welcome.ejs'), 'utf8')
const introStyles = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'css', 'squad-arcade-intro.css'), 'utf8')
const startupStyles = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'css', 'squad-arcade-startup.css'), 'utf8')
const launcherStyles = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'css', 'launcher.css'), 'utf8')
const appMarkup = fs.readFileSync(path.join(projectRoot, 'app', 'app.ejs'), 'utf8')

class FakeElement {
    constructor(document){
        this.document = document
        this.attributes = new Map()
        this.listeners = new Map()
        this.checked = false
        this.disabled = false
        this.style = {}
        this.textContent = ''
        this.className = ''
        this.dataset = {}
        this.children = []
        this.parentNode = null
        this.classList = { remove(){} }
    }

    addEventListener(type, listener){
        const listeners = this.listeners.get(type) || []
        listeners.push(listener)
        this.listeners.set(type, listeners)
    }

    removeEventListener(type, listener){
        const listeners = this.listeners.get(type) || []
        const remaining = listeners.filter(candidate => candidate !== listener)
        if(remaining.length === 0){
            this.listeners.delete(type)
        } else {
            this.listeners.set(type, remaining)
        }
    }

    listenerCount(type){
        return this.listeners.get(type)?.length || 0
    }

    dispatch(type, event = {}){
        this.listeners.get(type)?.forEach(listener => listener({
            key: undefined,
            preventDefault(){},
            target: this,
            ...event
        }))
    }

    click(){
        if(this.disabled){
            return
        }
        this.dispatch('click')
    }

    focus(){
        this.document.activeElement = this
    }

    appendChild(child){
        child.parentNode = this
        this.children.push(child)
        return child
    }

    remove(){
        if(this.parentNode != null){
            this.parentNode.children = this.parentNode.children.filter(child => child !== this)
            this.parentNode = null
        }
    }

    setAttribute(name, value){
        this.attributes.set(name, String(value))
    }

    removeAttribute(name){
        this.attributes.delete(name)
    }

    hasAttribute(name){
        return this.attributes.has(name)
    }
}

class FakeAudio {
    constructor({ playFails = false } = {}){
        this.currentTime = 12
        this.ended = false
        this.paused = true
        this.playCalls = 0
        this.pauseCalls = 0
        this.volume = 1
        this.playFails = playFails
        this.src = ''
        this.loadCalls = 0
        this.attributes = new Map([['data-src', 'assets/audio/intro-tormenta-arcade.wav']])
    }

    play(){
        this.playCalls += 1
        if(this.playFails){
            return { catch: handler => handler(new Error('Autoplay blocked')) }
        }
        this.paused = false
        return { catch(){} }
    }

    pause(){
        this.pauseCalls += 1
        this.paused = true
    }

    getAttribute(name){
        return this.attributes.get(name) || null
    }

    removeAttribute(name){
        this.attributes.delete(name)
    }

    load(){
        this.loadCalls += 1
    }
}

function createAnimeStub({ failInit = false, failExit = false } = {}){
    const calls = { timelines: [], cancelled: 0, paused: 0, resumed: 0 }
    return {
        calls,
        api: {
            stagger(value){
                return value
            },
            createTimeline(parameters){
                if(failInit || (failExit && calls.timelines.length >= 4)){
                    throw new Error('Timeline init failed')
                }
                const timeline = {
                    parameters,
                    steps: [],
                    add(targets, stepParameters, position){
                        this.steps.push({ targets, parameters: stepParameters, position })
                        return this
                    },
                    cancel(){ calls.cancelled += 1; this.cancelled = true },
                    pause(){ calls.paused += 1; this.paused = true },
                    resume(){ calls.resumed += 1; this.paused = false }
                }
                calls.timelines.push(timeline)
                return timeline
            }
        }
    }
}

function createIntroHarness({ animeAvailable = true, failInit = false, failExit = false, reducedMotion = false, selectedAccount = false, saveFails = false, audioPlayFails = false } = {}){
    const documentListeners = new Map()
    const windowListeners = new Map()
    const timers = new Map()
    const switches = []
    const warnings = []
    const audioUrls = { created: [], revoked: [] }
    const fetchCalls = []
    const views = { welcome: 'welcome', landing: 'landing', loginOptions: 'loginOptions' }
    let timerId = 0
    let currentView = views.welcome
    let loginPrepared = 0
    const document = {
        activeElement: null,
        hidden: false,
        addEventListener(type, listener){ documentListeners.set(type, listener) },
        removeEventListener(type){ documentListeners.delete(type) },
        createElement(){ return new FakeElement(document) },
        querySelector(selector){ return selector === '[data-squad-arcade-intro]' ? root : null }
    }
    const selectors = [
        '[data-sai-skip]',
        '[data-sai-continue]',
        '[data-sai-opt-out]',
        '[data-sai-live]',
        '[data-sai-status]',
        '.sai-impact',
        '.sai-impact-line',
        '.sai-seal-wrap',
        '.sai-copy',
        '.sai-seal-halo',
        '.sai-portal',
        '.sai-storm',
        '.sai-lightning',
        '.sai-fragments',
        '.sai-seal',
        '.sai-lockup',
        '[data-sai-logo]'
    ]
    const elements = Object.fromEntries(selectors.map(selector => [selector, new FakeElement(document)]))
    const audio = new FakeAudio({ playFails: audioPlayFails })
    elements['[data-sai-audio]'] = audio
    const groups = {
        '.sai-sky': [new FakeElement(document), new FakeElement(document)],
        '.sai-storm-ring': Array.from({ length: 3 }, () => new FakeElement(document)),
        '.sai-convergence': Array.from({ length: 6 }, () => new FakeElement(document)),
        '.sai-lightning path': Array.from({ length: 4 }, () => new FakeElement(document)),
        '.sai-portal-ring': Array.from({ length: 2 }, () => new FakeElement(document)),
        '.sai-fragment': Array.from({ length: 8 }, () => new FakeElement(document)),
        '.sai-final-control': Array.from({ length: 2 }, () => new FakeElement(document))
    }
    const root = new FakeElement(document)
    root.querySelector = selector => elements[selector] || null
    root.querySelectorAll = selector => groups[selector] || []
    const motionPreference = {
        matches: reducedMotion,
        addEventListener(_type, listener){ this.listener = listener },
        removeEventListener(){ this.listener = null }
    }
    const window = {
        async fetch(source){
            fetchCalls.push(source)
            return { ok: true, blob: async () => ({ type: 'audio/wav' }) }
        },
        matchMedia(){ return motionPreference },
        addEventListener(type, listener){ windowListeners.set(type, listener) },
        removeEventListener(type){ windowListeners.delete(type) },
        setTimeout(listener, delay){
            const id = ++timerId
            timers.set(id, { delay, listener })
            return id
        },
        clearTimeout(id){ timers.delete(id) }
    }
    const anime = createAnimeStub({ failInit, failExit })
    const config = {
        saves: 0,
        sets: [],
        getSelectedAccount(){ return selectedAccount ? { uuid: 'account' } : null },
        setShowIntro(value){ this.sets.push(value) },
        save(){
            this.saves += 1
            if(saveFails){
                throw new Error('Disk unavailable')
            }
        }
    }
    const context = {
        ConfigManager: config,
        LoggerUtil: { getLogger: () => ({ warn: (...args) => warnings.push(args) }) },
        VIEWS: views,
        console,
        document,
        getCurrentView: () => currentView,
        getStartupView: () => config.getSelectedAccount() == null ? views.loginOptions : views.landing,
        prepareLoginOptionsForStartup: () => { loginPrepared += 1 },
        require(name){
            assert.equal(name, 'animejs')
            if(!animeAvailable){
                throw new Error('Anime unavailable')
            }
            return anime.api
        },
        switchView(from, to){
            switches.push({ from, to })
            currentView = to
        },
        URL: {
            createObjectURL(blob){
                audioUrls.created.push(blob)
                return 'blob:intro-audio'
            },
            revokeObjectURL(url){ audioUrls.revoked.push(url) }
        },
        window
    }
    vm.runInNewContext(introSource, context, { filename: 'welcome.js' })
    const controller = context.window.createSquadArcadeIntro()
    return {
        anime,
        audio,
        audioUrls,
        config,
        controller,
        document,
        documentListeners,
        elements,
        fetchCalls,
        get loginPrepared(){ return loginPrepared },
        motionPreference,
        root,
        switches,
        timers,
        warnings,
        windowListeners
    }
}

function loadConfig({ existing = false } = {}){
    let saved = null
    const existingConfig = {
        settings: {
            game: {},
            launcher: {}
        },
        authenticationDatabase: {},
        javaConfig: {}
    }
    const fsExtra = {
        ensureDirSync(){},
        existsSync(file){ return existing && file.endsWith('config.json') },
        moveSync(){},
        readFileSync(){ return JSON.stringify(existingConfig) },
        writeFileSync(_file, content){ saved = JSON.parse(content) }
    }
    const exports = {}
    const context = {
        Boolean,
        exports,
        process: { env: { APPDATA: 'C:\\AppData' }, platform: 'win32' },
        require(name){
            if(name === 'fs-extra') return fsExtra
            if(name === 'helios-core') return { LoggerUtil: { getLogger: () => ({ error(){}, info(){} }) } }
            if(name === 'os') return { totalmem: () => 8 * 1073741824 }
            if(name === 'path') return path
            if(name === '@electron/remote') return { app: { getPath: () => 'C:\\UserData' } }
            throw new Error(`Unexpected module: ${name}`)
        }
    }
    vm.runInNewContext(configSource, context, { filename: 'configmanager.js' })
    exports.load()
    return { config: exports, get saved(){ return saved } }
}

function testConfigDefault(){
    const fresh = loadConfig()
    const existing = loadConfig({ existing: true })
    assert.equal(fresh.config.getShowIntro(), true, 'new configs show the intro by default')
    assert.equal(existing.config.getShowIntro(), true, 'existing configs without the setting show the intro')
    assert.equal(existing.saved, null, 'existing configs are normalized in memory without a startup write')
    existing.config.save()
    assert.equal(existing.saved.settings.launcher.showIntro, true, 'the next normal save persists the default')
}

function testStartupSurfaceFirstPaint(){
    const startupLink = appMarkup.indexOf('assets/css/squad-arcade-startup.css')
    const introLink = appMarkup.indexOf('assets/css/squad-arcade-intro.css')
    assert.ok(startupLink > -1 && startupLink < introLink && introLink < appMarkup.indexOf('</head>'), 'startup CSS is available before Intro and first paint')
    assert.match(appMarkup, /id="startupSurface"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"[^>]*aria-busy="true"/, 'startup surface announces one atomic busy status')
    assert.match(appMarkup, /class="sa-startup-title"/)
    assert.match(appMarkup, /class="sa-startup-detail"/)
    assert.match(startupStyles, /\.sa-startup\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*22px 0 0;[^}]*background:/s, 'startup surface paints an immediate full plate')
    assert.match(startupStyles, /\.sa-startup\[hidden\]\s*\{[^}]*display:\s*none\s*!important;/s)
    assert.match(startupStyles, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*animation:\s*none;/, 'reduced motion keeps a static visible progress state')
    assert.doesNotMatch(startupStyles, /anime/i, 'startup surface has no Anime dependency')
    assert.doesNotMatch(appMarkup, /loadingContainer|loadingContent|loadSpinnerContainer|loadCenterImage|loadSpinnerImage|LoadingSeal\.png|LoadingText\.png/, 'legacy loading markup and artwork are retired')
    assert.doesNotMatch(`${launcherStyles}\n${introStyles}`, /#loadingContainer|#loadCenterImage|#loadSpinnerImage|@keyframes rotating|\.rotating\s*\{/, 'legacy loading selectors are retired')
    assert.doesNotMatch(launcherStyles, /#welcomeContent|#welcomeImageSeal|#welcomeHeader|#welcomeDescription|#welcomeDescCTA|#welcomeSVG|#welcomeButtonContent/, 'legacy Welcome selectors stay retired from the shared stylesheet')
    assert.doesNotMatch(launcherStyles, /Welcome View \(welcome\.ejs\)/, 'the shared stylesheet no longer owns the Squad Arcade intro')
    assert.equal(fs.existsSync(path.join(projectRoot, 'app', 'assets', 'images', 'LoadingSeal.png')), false)
    assert.equal(fs.existsSync(path.join(projectRoot, 'app', 'assets', 'images', 'LoadingText.png')), false)
}

function testOptOutStartupContract(){
    const config = loadConfig().config
    config.setShowIntro(false)
    assert.equal(config.getShowIntro(), false, 'opt-out prevents intro selection')
    const earlyFunction = uiBinderSource.slice(
        uiBinderSource.indexOf('function hideStartupSurface('),
        uiBinderSource.indexOf('async function showMainUI')
    )
    const readyHandler = uiBinderSource.slice(uiBinderSource.indexOf('document.addEventListener(\'readystatechange\''))
    assert.match(earlyFunction, /!ConfigManager\.getShowIntro\(\)/, 'opt-out gates intro creation')
    assert.match(earlyFunction, /window\.createSquadArcadeIntro\?\.\(\)/, 'intro is created lazily')
    assert.match(earlyFunction, /hideStartupSurface\(\)\s*intro\.start\(\)/, 'early intro replaces the native startup surface before motion starts')
    assert.ok(readyHandler.indexOf('showIntroForStartup()') < readyHandler.indexOf('if(rscShouldLoad)'), 'intro is presented before deferred runtime work')
    assert.doesNotMatch(introSource, /window\.squadArcadeIntro = createSquadArcadeIntro/, 'disabled intro is not initialized by welcome.js')

    function runEarlyStartup(showIntro){
        const elements = {
            main: new FakeElement(null),
            welcomeContainer: new FakeElement(null),
            startupSurface: new FakeElement(null)
        }
        elements.startupSurface.setAttribute('aria-busy', 'true')
        let created = 0
        let started = 0
        const context = {
            ConfigManager: { getShowIntro: () => showIntro },
            VIEWS: { welcome: '#welcomeContainer' },
            currentView: null,
            fatalStartupError: false,
            introStarted: false,
            document: {
                getElementById: id => elements[id],
                querySelector: () => elements.welcomeContainer
            },
            window: {
                createSquadArcadeIntro(){
                    created += 1
                    return { start(){ started += 1 } }
                }
            }
        }
        vm.runInNewContext(`${earlyFunction}\nresult = showIntroForStartup()`, context)
        return { context, created, elements, result: context.result, started }
    }

    const enabled = runEarlyStartup(true)
    assert.equal(enabled.result, true)
    assert.equal(enabled.created, 1)
    assert.equal(enabled.started, 1)
    assert.equal(enabled.elements.startupSurface.hidden, true, 'enabled intro immediately replaces the startup surface')
    assert.equal(enabled.elements.startupSurface.attributes.get('aria-busy'), 'false')
    assert.equal(enabled.elements.welcomeContainer.style.display, 'block')

    const disabled = runEarlyStartup(false)
    assert.equal(disabled.result, false)
    assert.equal(disabled.created, 0, 'disabled intro keeps the native startup path without initialization')
    assert.equal(disabled.elements.startupSurface.hidden, undefined, 'disabled intro keeps the native startup surface available')
    assert.equal(disabled.elements.startupSurface.attributes.get('aria-busy'), 'true')
}

function testPersistenceAndRoutes(){
    const continued = createIntroHarness({ selectedAccount: true })
    continued.controller.setRuntimeReady()
    continued.controller.start()
    continued.anime.calls.timelines[0].parameters.onComplete()
    continued.elements['[data-sai-opt-out]'].checked = true
    continued.elements['[data-sai-continue]'].click()
    continued.elements['[data-sai-continue]'].click()
    assert.deepEqual(continued.config.sets, [false], 'continue persists opt-out once')
    assert.equal(continued.config.saves, 1)
    assert.equal(continued.switches.length, 0, 'Continue waits for the visual exit')
    assert.equal(continued.controller.exitDuration, 999)
    const exit = continued.anime.calls.timelines[4]
    assert.ok(exit, 'Continue creates an exit timeline once')
    assert.equal(exit.steps[0].parameters.duration, 169, 'exit starts with a proportionally scaled slam')
    const shardStep = exit.steps.find(step => step.targets.length === 10)
    assert.equal(shardStep.position + shardStep.parameters.duration + (9 * shardStep.parameters.delay), continued.controller.exitDuration, 'shard burst defines the 999 ms visual duration')
    exit.parameters.onComplete()
    exit.parameters.onComplete()
    assert.deepEqual(continued.switches, [{ from: 'welcome', to: 'landing' }], 'selected account routes to Home once')

    const skipped = createIntroHarness()
    skipped.controller.setRuntimeReady()
    skipped.controller.start()
    skipped.elements['[data-sai-skip]'].click()
    assert.equal(skipped.config.saves, 0, 'skip without checkbox does not persist')
    assert.deepEqual(skipped.switches, [{ from: 'welcome', to: 'loginOptions' }], 'no account routes to LoginOptions')
    assert.equal(skipped.loginPrepared, 1, 'login callbacks are configured')

    const skippedOptOut = createIntroHarness()
    skippedOptOut.controller.setRuntimeReady()
    skippedOptOut.elements['[data-sai-opt-out]'].checked = true
    skippedOptOut.elements['[data-sai-skip]'].click()
    assert.deepEqual(skippedOptOut.config.sets, [false], 'skip with checkbox persists opt-out')
    assert.equal(skippedOptOut.config.saves, 1)
}

function testFallbacksAndMotion(){
    const unavailable = createIntroHarness({ animeAvailable: false })
    unavailable.controller.start()
    assert.equal(unavailable.controller.isFinal(), true, 'missing Anime shows final composition')
    assert.equal(unavailable.root.hasAttribute('data-final'), true)
    assert.equal(unavailable.elements['[data-sai-continue]'].disabled, true, 'fallback still waits for runtime')
    unavailable.controller.setRuntimeReady()
    assert.equal(unavailable.elements['[data-sai-continue]'].disabled, false)
    unavailable.elements['[data-sai-continue]'].click()
    assert.equal(unavailable.switches.length, 1, 'missing Anime navigates immediately on Continue')

    const reduced = createIntroHarness({ reducedMotion: true })
    reduced.controller.start()
    assert.equal(reduced.controller.isFinal(), true, 'initial reduced motion skips the cinematic')
    assert.equal(reduced.anime.calls.timelines.length, 0)
    assert.equal(reduced.elements['[data-sai-continue]'].disabled, true, 'reduced motion still waits for runtime')
    reduced.controller.setRuntimeReady()
    reduced.elements['[data-sai-continue]'].click()
    assert.equal(reduced.switches.length, 1, 'reduced motion navigates immediately on Continue')

    const dynamic = createIntroHarness()
    dynamic.controller.start()
    dynamic.motionPreference.listener({ matches: true })
    assert.equal(dynamic.controller.isFinal(), true, 'dynamic reduced motion completes the cinematic')
    assert.equal(dynamic.anime.calls.cancelled, 1)

    const initFailure = createIntroHarness({ failInit: true })
    assert.doesNotThrow(() => initFailure.controller.start())
    assert.equal(initFailure.controller.isFinal(), true, 'timeline errors show final composition')

    const exitFailure = createIntroHarness({ failExit: true })
    exitFailure.controller.setRuntimeReady()
    exitFailure.controller.start()
    exitFailure.anime.calls.timelines[0].parameters.onComplete()
    assert.doesNotThrow(() => exitFailure.elements['[data-sai-continue]'].click())
    assert.equal(exitFailure.switches.length, 1, 'exit initialization errors still navigate')
    assert.equal(exitFailure.root.children.length, 0, 'failed exit initialization removes decorations')
}

async function testAudioLifecycle(){
    const active = createIntroHarness()
    active.controller.start()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(active.audio.volume, 0.2, 'intro audio is capped at 20% volume')
    assert.equal(active.audio.currentTime, 0, 'intro audio starts from the beginning')
    assert.equal(active.audio.playCalls, 1, 'audio starts with the cinematic timeline')
    assert.deepEqual(active.fetchCalls, ['assets/audio/intro-tormenta-arcade.wav'], 'audio loads through fetch instead of a file media URL')
    assert.equal(active.audio.src, 'blob:intro-audio', 'audio plays from the compatible Blob URL')

    active.windowListeners.get('blur')()
    active.windowListeners.get('focus')()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(active.audio.pauseCalls, 1, 'window blur pauses intro audio')
    assert.equal(active.audio.playCalls, 2, 'window focus resumes intro audio without resetting it')

    active.elements['[data-sai-skip]'].click()
    assert.equal(active.audio.pauseCalls, 2, 'Skip stops intro audio')

    const continued = createIntroHarness()
    continued.controller.setRuntimeReady()
    continued.controller.start()
    await new Promise(resolve => setImmediate(resolve))
    continued.anime.calls.timelines[0].parameters.onComplete()
    continued.elements['[data-sai-continue]'].click()
    assert.equal(continued.audio.pauseCalls, 1, 'Continue stops intro audio before the exit effect')

    const fatal = createIntroHarness()
    fatal.controller.start()
    await new Promise(resolve => setImmediate(resolve))
    fatal.controller.cancelForFatal()
    assert.equal(fatal.audio.pauseCalls, 1, 'fatal startup cleanup stops intro audio')
    assert.deepEqual(fatal.audioUrls.revoked, ['blob:intro-audio'], 'fatal startup cleanup revokes the Blob URL')

    const reduced = createIntroHarness({ reducedMotion: true })
    reduced.controller.start()
    assert.equal(reduced.audio.playCalls, 0, 'reduced motion does not play a cinematic without a timeline')

    const blocked = createIntroHarness({ audioPlayFails: true })
    blocked.controller.start()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(blocked.warnings.length, 1, 'blocked autoplay is handled and logged')
    blocked.controller.destroy()
    assert.equal(blocked.audio.pauseCalls, 1, 'destroy always stops the audio element')
    assert.equal(blocked.audio.loadCalls, 1, 'destroy releases the audio element resource')
    assert.deepEqual(blocked.audioUrls.revoked, ['blob:intro-audio'], 'destroy revokes the Blob URL')
}

function testContinueExitLifecycle(){
    const timed = createIntroHarness()
    timed.controller.setRuntimeReady()
    timed.controller.start()
    timed.anime.calls.timelines[0].parameters.onComplete()
    timed.elements['[data-sai-logo]'].dispatch('pointerenter')
    timed.elements['[data-sai-continue]'].click()

    assert.equal(timed.root.hasAttribute('data-ambient'), false, 'Continue clears ambient state before exploding')
    assert.equal(timed.root.hasAttribute('data-logo-hover'), false, 'Continue clears hover state before exploding')
    assert.equal(timed.anime.calls.cancelled, 4, 'Continue cancels three ambient loops and active hover')
    assert.equal(timed.root.children.length, 1, 'one disposable effect layer is attached')
    const effects = timed.root.children[0]
    assert.equal(effects.attributes.get('aria-hidden'), 'true')
    assert.equal(effects.children.filter(child => child.className === 'sai-exit-shard').length, 10)
    assert.equal(effects.children.filter(child => child.className === 'sai-exit-smoke').length, 6)
    assert.equal(timed.switches.length, 0)
    assert.equal(timed.timers.size, 1)
    const timeout = [...timed.timers.values()][0]
    assert.equal(timeout.delay, 1250, 'defensive timeout leaves a safe margin after the 999 ms visual exit')
    timeout.listener()
    timeout.listener()
    assert.equal(timed.switches.length, 1, 'timeout navigates exactly once')
    assert.equal(timed.root.children.length, 0, 'navigation removes all effect nodes')

    const fatal = createIntroHarness()
    fatal.controller.setRuntimeReady()
    fatal.controller.start()
    fatal.anime.calls.timelines[0].parameters.onComplete()
    fatal.elements['[data-sai-continue]'].click()
    const fatalExit = fatal.anime.calls.timelines[4]
    const fatalTimeout = [...fatal.timers.values()][0]
    fatal.controller.cancelForFatal()
    fatalExit.parameters.onComplete()
    fatalTimeout.listener()
    assert.equal(fatal.switches.length, 0, 'fatal during explosion prevents late navigation')
    assert.equal(fatal.root.children.length, 0)

    const destroyed = createIntroHarness()
    destroyed.controller.setRuntimeReady()
    destroyed.controller.start()
    destroyed.anime.calls.timelines[0].parameters.onComplete()
    destroyed.elements['[data-sai-continue]'].click()
    const destroyedExit = destroyed.anime.calls.timelines[4]
    const destroyedTimeout = [...destroyed.timers.values()][0]
    destroyed.controller.destroy()
    destroyedExit.parameters.onComplete()
    destroyedTimeout.listener()
    assert.equal(destroyed.switches.length, 0, 'destroy during explosion prevents late navigation')
    assert.equal(destroyed.root.children.length, 0)
}

function testKeyboardAndCleanup(){
    const escaped = createIntroHarness()
    escaped.controller.start()
    escaped.documentListeners.get('keydown')({ key: 'Escape', preventDefault(){} })
    escaped.documentListeners.get('keydown')({ key: 'Escape', preventDefault(){} })
    assert.equal(escaped.switches.length, 0, 'Escape defers navigation while runtime is pending')
    assert.equal(escaped.controller.isExitRequested(), true)
    escaped.controller.setRuntimeReady()
    escaped.controller.setRuntimeReady()
    assert.equal(escaped.switches.length, 1, 'deferred Escape navigates once when ready')
    assert.equal(escaped.timers.size, 0, 'Escape clears the safety timeout')
    assert.equal(escaped.anime.calls.cancelled, 1, 'Escape cancels the timeline')
    assert.equal(escaped.documentListeners.size, 0, 'navigation removes document listeners')
    assert.equal(escaped.windowListeners.size, 0, 'navigation removes window listeners')

    const completed = createIntroHarness()
    completed.controller.start()
    assert.equal(completed.timers.size, 1)
    completed.anime.calls.timelines[0].parameters.onComplete()
    assert.equal(completed.timers.size, 0, 'completion clears all timeouts')
    assert.equal(completed.controller.duration, 3600)
    assert.ok(completed.controller.duration <= 4000, 'intro respects the hard duration limit')

    const paused = createIntroHarness()
    paused.controller.start()
    paused.windowListeners.get('blur')()
    paused.windowListeners.get('focus')()
    assert.equal(paused.anime.calls.paused, 1, 'window blur pauses active work')
    assert.equal(paused.anime.calls.resumed, 1, 'window focus resumes instead of restarting')
    assert.equal(paused.anime.calls.timelines.length, 1)
}

function testAmbientLifecycle(){
    const active = createIntroHarness()
    active.controller.start()
    assert.equal(active.anime.calls.timelines.length, 1, 'only the cinematic exists before final')
    active.anime.calls.timelines[0].parameters.onComplete()
    assert.equal(active.anime.calls.timelines.length, 4, 'three ambient loops start after final')
    assert.equal(active.anime.calls.timelines.slice(1).every(item => item.parameters.loop === true), true)
    assert.equal(active.root.hasAttribute('data-ambient'), true)
    assert.equal(active.timers.size, 0, 'ambient work uses no timeouts')

    active.controller.showFinal()
    assert.equal(active.anime.calls.timelines.length, 4, 'repeated final presentation does not accumulate loops')
    active.windowListeners.get('blur')()
    assert.equal(active.anime.calls.paused, 3, 'blur pauses every ambient loop')
    active.windowListeners.get('focus')()
    assert.equal(active.anime.calls.resumed, 3, 'focus resumes existing ambient loops')
    assert.equal(active.anime.calls.timelines.length, 4, 'focus does not recreate loops')

    active.document.hidden = true
    active.documentListeners.get('visibilitychange')()
    assert.equal(active.anime.calls.paused, 6, 'hidden pauses ambient loops')
    active.document.hidden = false
    active.documentListeners.get('visibilitychange')()
    assert.equal(active.anime.calls.resumed, 6, 'visible resumes ambient loops while final is active')

    active.motionPreference.listener({ matches: true })
    assert.equal(active.anime.calls.cancelled, 3, 'reduced motion cancels all ambient loops')
    assert.equal(active.root.hasAttribute('data-ambient'), false)
    active.windowListeners.get('focus')()
    assert.equal(active.anime.calls.timelines.length, 4, 'reduced motion prevents loop recreation')

    active.motionPreference.listener({ matches: false })
    assert.equal(active.anime.calls.timelines.length, 7, 'ambient loops can restart once motion is allowed')
    active.controller.destroy()
    assert.equal(active.anime.calls.cancelled, 6, 'destroy cancels restarted ambient loops')
    assert.equal(active.root.hasAttribute('data-ambient'), false)
}

function testLogoHoverLifecycle(){
    const hovered = createIntroHarness()
    const logo = hovered.elements['[data-sai-logo]']
    hovered.controller.start()
    hovered.anime.calls.timelines[0].parameters.onComplete()
    assert.equal(logo.listenerCount('pointerenter'), 1)
    assert.equal(logo.listenerCount('pointerleave'), 1)

    logo.dispatch('pointerenter')
    assert.equal(hovered.anime.calls.timelines.length, 5, 'hover starts one aggressive reaction')
    assert.equal(hovered.root.hasAttribute('data-logo-hover'), true)
    const reaction = hovered.anime.calls.timelines[4]
    assert.equal(reaction.steps.some(step => step.targets === hovered.elements['.sai-portal']), true, 'reaction expands the portal layer')
    assert.equal(reaction.steps.some(step => step.targets === hovered.elements['.sai-seal']), true, 'reaction hits the seal layer')
    assert.equal(reaction.steps.some(step => step.targets === hovered.elements['.sai-lockup']), false, 'reaction never moves the lockup')

    logo.dispatch('pointerenter')
    assert.equal(hovered.anime.calls.timelines.length, 6, 'rapid re-entry replaces the reaction')
    assert.equal(hovered.anime.calls.cancelled, 1, 'rapid re-entry cancels the prior reaction')
    logo.dispatch('pointerleave')
    assert.equal(hovered.anime.calls.timelines.length, 7, 'leave creates one controlled restoration')
    assert.equal(hovered.anime.calls.cancelled, 2, 'leave cancels the active reaction')
    assert.equal(hovered.root.hasAttribute('data-logo-hover'), false)

    hovered.controller.destroy()
    assert.equal(logo.listenerCount('pointerenter'), 0, 'destroy removes logo enter listener')
    assert.equal(logo.listenerCount('pointerleave'), 0, 'destroy removes logo leave listener')
    const timelineCount = hovered.anime.calls.timelines.length
    logo.dispatch('pointerenter')
    assert.equal(hovered.anime.calls.timelines.length, timelineCount, 'destroyed logo cannot create reactions')

    const reduced = createIntroHarness({ reducedMotion: true })
    reduced.controller.start()
    reduced.elements['[data-sai-logo]'].dispatch('pointerenter')
    assert.equal(reduced.anime.calls.timelines.length, 0, 'reduced motion disables animated hover')

    const suspended = createIntroHarness()
    const suspendedLogo = suspended.elements['[data-sai-logo]']
    suspended.controller.start()
    suspended.anime.calls.timelines[0].parameters.onComplete()
    suspendedLogo.dispatch('pointerenter')
    suspended.windowListeners.get('blur')()
    assert.equal(suspended.anime.calls.paused, 4, 'blur pauses ambient and hover work')
    suspendedLogo.dispatch('pointerleave')
    assert.equal(suspended.anime.calls.timelines.length, 5, 'leave while blurred does not create restoration work')
    suspended.windowListeners.get('focus')()
    assert.equal(suspended.anime.calls.timelines.length, 5, 'focus resumes without recreating a hover that already left')
}

function testRuntimeCoordination(){
    const runtimeFirst = createIntroHarness({ selectedAccount: true })
    runtimeFirst.controller.setRuntimeReady()
    runtimeFirst.controller.start()
    assert.equal(runtimeFirst.switches.length, 0, 'runtime readiness does not skip the timeline')
    runtimeFirst.anime.calls.timelines[0].parameters.onComplete()
    assert.equal(runtimeFirst.elements['[data-sai-continue]'].disabled, false, 'CTA enables after both gates complete')

    const timelineFirst = createIntroHarness()
    timelineFirst.controller.start()
    timelineFirst.anime.calls.timelines[0].parameters.onComplete()
    assert.equal(timelineFirst.elements['[data-sai-status]'].textContent, 'PREPARANDO LAUNCHER...')
    assert.equal(timelineFirst.elements['[data-sai-continue]'].disabled, true)
    timelineFirst.elements['[data-sai-continue]'].click()
    assert.equal(timelineFirst.switches.length, 0, 'disabled Continue cannot lose a navigation request')
    timelineFirst.controller.setRuntimeReady()
    assert.equal(timelineFirst.elements['[data-sai-continue]'].disabled, false)

    const skipped = createIntroHarness()
    skipped.controller.start()
    skipped.elements['[data-sai-skip]'].click()
    assert.equal(skipped.controller.isFinal(), true, 'early skip resolves to the stable lockup')
    assert.equal(skipped.elements['[data-sai-status]'].textContent, 'PREPARANDO LAUNCHER...')
    assert.equal(skipped.switches.length, 0)
    skipped.controller.setRuntimeReady()
    assert.deepEqual(skipped.switches, [{ from: 'welcome', to: 'loginOptions' }])
}

function testSaveFailureAndFatalPriority(){
    const failure = createIntroHarness({ saveFails: true })
    failure.controller.setRuntimeReady()
    failure.elements['[data-sai-opt-out]'].checked = true
    assert.doesNotThrow(() => failure.elements['[data-sai-skip]'].click())
    assert.equal(failure.switches.length, 1, 'save failure does not block navigation')
    assert.equal(failure.warnings.length, 1, 'save failure is logged')

    const fatal = createIntroHarness()
    fatal.controller.start()
    fatal.elements['[data-sai-opt-out]'].checked = true
    fatal.controller.cancelForFatal()
    assert.equal(fatal.root.hasAttribute('data-fatal'), true)
    assert.equal(fatal.anime.calls.cancelled, 1)
    assert.equal(fatal.config.saves, 0, 'fatal never persists opt-out')
    assert.equal(fatal.switches.length, 0)
    assert.match(uiBinderSource, /intro\?\.cancelForFatal\(\)/, 'fatal startup explicitly cancels the intro')
    assert.match(uiBinderSource, /intro\.setRuntimeReady\(\)/, 'showMainUI explicitly signals runtime readiness')

    const finalFatal = createIntroHarness()
    finalFatal.controller.start()
    finalFatal.anime.calls.timelines[0].parameters.onComplete()
    finalFatal.elements['[data-sai-logo]'].dispatch('pointerenter')
    finalFatal.controller.cancelForFatal()
    assert.equal(finalFatal.anime.calls.cancelled, 4, 'fatal cancels three ambient loops and active hover')
    assert.equal(finalFatal.root.hasAttribute('data-ambient'), false)
    assert.equal(finalFatal.elements['[data-sai-logo]'].listenerCount('pointerenter'), 0)
}

function testCompositionContract(){
    assert.equal((introMarkup.match(/class="sai-lockup"/g) || []).length, 1, 'markup has one lockup')
    assert.equal((introMarkup.match(/class="sai-seal"/g) || []).length, 1, 'markup has one logo')
    assert.doesNotMatch(introMarkup, /sai-flame|sai-flame-crown|sai-orbit-item/)
    assert.doesNotMatch(introStyles, /sai-flame|sai-flame-crown|sai-orbit-item/)
    assert.doesNotMatch(introSource, /sai-flame/)
    assert.doesNotMatch(`${introMarkup}\n${introStyles}\n${introSource}`, /ANTES/)
    assert.match(introStyles, /\.sai-lockup\s*\{[^}]*left:\s*50%;[^}]*top:\s*50%;[^}]*transform:\s*translate\(-50%, -50%\)/s)
    assert.doesNotMatch(introStyles, /\[data-final\][^{]*\.sai-lockup/, 'showFinal never changes lockup geometry')
    assert.match(introMarkup, /class="sai-actions"[^>]*>[\s\S]*data-sai-status[\s\S]*data-sai-continue/, 'status and CTA share one centered action wrapper')
    assert.match(introStyles, /\.sai-actions\s*\{[^}]*display:\s*grid;[^}]*width:\s*100%;[^}]*justify-items:\s*center;/s, 'CTA wrapper centers its complete bounding box')
    assert.match(introStyles, /#welcomeButton\.sai-continue\s*\{[^}]*display:\s*inline-grid;[^}]*place-items:\s*center;[^}]*right:\s*auto;/s, 'Intro resets the legacy right offset and centers the label')
    assert.match(introStyles, /\.sai-continue-arrow\s*\{[^}]*position:\s*absolute;[^}]*right:/s, 'CTA arrow is outside label flow')
    assert.match(introMarkup, /<label class="sai-opt-out" hidden>[\s\S]*<input type="checkbox" data-sai-opt-out>/, 'opt-out DOM and input contract remain present but hidden')
    assert.match(introStyles, /\.sai-opt-out\[hidden\]\s*\{[^}]*display:\s*none;/s, 'hidden opt-out cannot remain visible or focusable')
    assert.match(introStyles, /\.sai-exit-effects\s*\{[^}]*pointer-events:\s*none;/s, 'exit decorations cannot block clicks')
    assert.match(introMarkup, /class="sai-seal"[^>]*alt="MCSquad Arcade emblem"/, 'logo retains useful alternative text')
    assert.doesNotMatch(introMarkup, /data-sai-logo[^>]*tabindex|data-sai-logo[^>]*role="button"/, 'decorative hover does not create a false action')
    assert.match(introSource, /const INTRO_DURATION = 3600/)
    assert.match(introSource, /const INTRO_TIMEOUT = 4000/)
    assert.match(introSource, /const INTRO_AUDIO_VOLUME = 0\.2/)
    assert.match(introMarkup, /<audio data-sai-audio data-src="assets\/audio\/intro-tormenta-arcade\.wav"><\/audio>/, 'markup exposes the selected audio for Blob loading')

    const cleaned = createIntroHarness()
    cleaned.controller.start()
    const skipButton = cleaned.elements['[data-sai-skip]']
    const continueButton = cleaned.elements['[data-sai-continue]']
    assert.equal(skipButton.listenerCount('click'), 1)
    assert.equal(continueButton.listenerCount('click'), 1)
    assert.doesNotThrow(() => {
        cleaned.controller.destroy()
        cleaned.controller.destroy()
    }, 'destroy is idempotent')
    assert.equal(cleaned.timers.size, 0)
    assert.equal(cleaned.documentListeners.size, 0)
    assert.equal(cleaned.windowListeners.size, 0)
    assert.equal(skipButton.listenerCount('click'), 0, 'destroy removes the Skip listener')
    assert.equal(continueButton.listenerCount('click'), 0, 'destroy removes the Continue listener')
    skipButton.disabled = false
    continueButton.disabled = false
    skipButton.click()
    continueButton.click()
    assert.equal(cleaned.controller.isExitRequested(), false, 'destroyed controls have no active callbacks')
    assert.equal(cleaned.switches.length, 0)
}

async function run(){
    testConfigDefault()
    testStartupSurfaceFirstPaint()
    testOptOutStartupContract()
    testPersistenceAndRoutes()
    testFallbacksAndMotion()
    await testAudioLifecycle()
    testKeyboardAndCleanup()
    testAmbientLifecycle()
    testLogoHoverLifecycle()
    testContinueExitLifecycle()
    testRuntimeCoordination()
    testSaveFailureAndFatalPriority()
    testCompositionContract()
    console.log('Squad Arcade intro harness: 68 scenarios passed')
}

run().catch(error => {
    console.error(error)
    process.exitCode = 1
})

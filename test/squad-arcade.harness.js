const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'assets', 'js', 'scripts', 'squad-arcade.js'), 'utf8')

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

function createHarness({ animeAvailable = true, reducedMotion = false } = {}){
    const root = new FakeElement({ theme: 'overworld' })
    const landing = new FakeElement()
    root.parentElement = landing
    const legacy = Object.fromEntries(['upper', 'lower', 'newsContainer'].map(id => [id, new FakeElement()]))
    const launchButton = new FakeElement()
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
    const groups = {
        '[data-sa-theme]': themes,
        '[data-sa-theme-close]': [new FakeElement()],
        '[data-sa-open]': [],
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
    const config = {
        theme: 'overworld',
        getLauncherTheme(){ return this.theme },
        setLauncherTheme(theme){ this.theme = theme },
        save(){},
        getSelectedAccount(){ return null },
        getSelectedServer(){ return 'alpha' }
    }
    const server = id => ({ rawServer: { id, name: `Server ${id}`, description: 'Description', minecraftVersion: '1.21', version: '2.0', icon: `${id}.png` } })
    const document = {
        hidden: false,
        querySelector(selector){ return selector === '[data-squad-arcade]' ? root : null },
        getElementById(id){ return id === 'launch_button' ? launchButton : legacy[id] || null },
        addEventListener(type, listener){ documentListeners.set(type, listener) }
    }
    const window = {
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
        prepareSettings: async () => {},
        switchView(){},
        getCurrentView(){ return 'landing' },
        VIEWS: { landing: 'landing', settings: 'settings' },
        settingsNavItemListener(){},
        toggleServerSelection(){}
    }
    vm.runInNewContext(source, context, { filename: 'squad-arcade.js' })
    return { anime, api: context.window.squadArcade, document, documentListeners, elements, landing, motionPreference, root, server, themes, timers, windowListeners }
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

    animated.api.setLaunching(true)
    animated.api.setLaunching(true)
    assert.equal(animated.root.hasAttribute('data-launching'), true)
    assert.equal(animated.elements['[data-sa-play]'].getAttribute('aria-busy'), 'true')
    assert.equal(animated.timers.size, 0, 'launching cancels the attraction timeout')
    assert.equal(animated.anime.calls.timelines.length, 4, 'launch reaction runs once per launch start')
    animated.api.setLaunchPercentage(37)
    assert.equal(animated.elements['[data-sa-progress-track]'].getAttribute('aria-valuenow'), '37')
    animated.api.setLaunching(false)
    assert.equal(animated.root.hasAttribute('data-launching'), false)
    assert.equal(animated.elements['[data-sa-play]'].getAttribute('aria-busy'), null)
    assert.equal(animated.elements['[data-sa-progress-label]'].textContent, '0%')
    assert.equal(animated.timers.size, 1, 'leaving launch restores the attraction cycle')

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

    console.log('Squad Arcade harness: 5 scenarios passed')
}

run().catch(error => {
    console.error(error)
    process.exitCode = 1
})

(() => {
    'use strict'

    const root = document.querySelector('[data-squad-arcade]')
    const legacyLanding = ['upper', 'lower', 'newsContainer'].map(id => document.getElementById(id))
    if(root == null || legacyLanding.some(element => element == null)){
        return
    }
    const landing = root.parentElement

    let anime = null
    try {
        anime = require('animejs')
    } catch(_err) {
        // The Home remains fully functional when the optional motion layer cannot load.
    }
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const activeAnimations = new Map()
    let reducedMotion = motionPreference.matches
    let currentServerId = null
    let attractionTimeout = null
    let lastProgressSweep = -10

    const themes = {
        overworld: 'Overworld Daybreak',
        creeper: 'Creeper Circuit',
        nether: 'Nether Forge',
        ender: 'Ender Rift'
    }
    const get = selector => root.querySelector(selector)
    const getAll = selector => Array.from(root.querySelectorAll(selector))
    const playButton = get('[data-sa-play]')
    const playReadyDetail = get('[data-sa-play-ready-detail]')
    const playDetail = get('[data-sa-play-detail]')
    const progress = get('[data-sa-progress]')
    const progressLabel = get('[data-sa-progress-label]')
    const progressTrack = get('[data-sa-progress-track]')
    const liveRegion = get('[data-sa-live]')
    const themeDialog = get('[data-sa-theme-dialog]')
    const themeTrigger = get('[data-sa-theme-trigger]')

    function stopAnimation(name){
        const animation = activeAnimations.get(name)
        if(animation != null){
            animation.cancel()
            activeAnimations.delete(name)
        }
    }

    function rememberAnimation(name, animation){
        activeAnimations.set(name, animation)
        return animation
    }

    function animateOnce(name, targets, parameters){
        if(reducedMotion || anime?.animate == null){
            return null
        }
        stopAnimation(name)
        let animation
        const onComplete = parameters.onComplete
        animation = anime.animate(targets, {
            ...parameters,
            onComplete: () => {
                if(activeAnimations.get(name) === animation){
                    activeAnimations.delete(name)
                }
                onComplete?.()
            }
        })
        return rememberAnimation(name, animation)
    }

    function createSequence(name, parameters = {}){
        if(reducedMotion || anime?.createTimeline == null){
            return null
        }
        stopAnimation(name)
        let timeline
        timeline = anime.createTimeline({
            ...parameters,
            onComplete: () => {
                if(activeAnimations.get(name) === timeline){
                    activeAnimations.delete(name)
                }
            }
        })
        return rememberAnimation(name, timeline)
    }

    function runEntrance(){
        const timeline = createSequence('entrance', { defaults: { ease: 'out(4)' } })
        if(timeline == null){
            return
        }
        timeline
            .add(get('.sa-marquee'), { opacity: [0, 1], y: [-58, 0], duration: 430 }, 0)
            .add(getAll('.sa-brand, .sa-marquee nav button, .sa-theme-trigger'), { opacity: [0, 1], y: [-18, 0], scale: [.72, 1], delay: anime.stagger(42), duration: 360 }, 90)
            .add(get('.sa-cartridge'), { opacity: [0, 1], y: [-42, 0], scale: [.9, 1], rotate: [-1.5, 0], duration: 520 }, 150)
            .add(get('.sa-server-icon-stage'), { opacity: [0, 1], scale: [.28, 1.08, 1], rotate: [-14, 3, 0], duration: 560 }, 270)
            .add(get('.sa-server-copy'), { opacity: [0, 1], x: [-26, 0], duration: 390 }, 330)
            .add(get('.sa-player'), { opacity: [0, 1], x: [45, 0], scale: [.88, 1], duration: 470 }, 260)
            .add(getAll('.sa-actions > button'), { opacity: [0, 1], y: [38, 0], scale: [.78, 1], delay: anime.stagger(85), duration: 480 }, 420)
            .add(get('.sa-footer'), { opacity: [0, 1], y: [24, 0], duration: 320 }, 560)
    }

    function runServerSwap(){
        const timeline = createSequence('serverSwap', { defaults: { ease: 'out(5)' } })
        if(timeline == null){
            return
        }
        timeline
            .add(get('.sa-server-icon-stage'), { opacity: [.35, 1], scale: [1.38, .82, 1], rotate: [-8, 2, 0], duration: 520 }, 0)
            .add(get('.sa-server-copy'), { opacity: [.35, 1], x: [22, -4, 0], duration: 390 }, 70)
            .add(getAll('.sa-server-meta span'), { opacity: [.4, 1], y: [10, 0], delay: anime.stagger(38), duration: 300 }, 150)
    }

    function runThemePulse(){
        animateOnce('themePulse', get('.sa-theme-pulse'), {
            opacity: [0, .58, 0],
            scale: [.72, 1.12],
            duration: 520,
            ease: 'out(3)'
        })
        animateOnce('themeFrame', get('.sa-cartridge'), {
            scale: [.985, 1.008, 1],
            duration: 460,
            ease: 'out(4)'
        })
    }

    function runLaunchReaction(){
        const timeline = createSequence('launchReaction', { defaults: { ease: 'out(5)' } })
        if(timeline == null){
            return
        }
        timeline
            .add(playButton, { scale: [1, .94, 1.025, 1], x: [0, -5, 4, 0], duration: 480 }, 0)
            .add(get('.sa-play-icon'), { scale: [1, .7, 1.35, 1], x: [0, 10, 0], duration: 420 }, 70)
    }

    function runPlayImpact(){
        const timeline = createSequence('playImpact', { defaults: { ease: 'out(6)' } })
        if(timeline == null){
            return
        }
        timeline
            .add(playButton, { scale: [1, .9, 1.035, 1], y: [0, 7, -2, 0], duration: 360 }, 0)
            .add(get('.sa-play-shockwave'), { opacity: [0, .9, 0], scale: [.75, 1.22], duration: 390 }, 20)
            .add(get('.sa-play-icon'), { x: [0, 13, -2, 0], scale: [1, 1.45, 1], duration: 330 }, 25)
    }

    function isHomeActive(){
        const currentView = typeof getCurrentView === 'function' ? getCurrentView() : VIEWS.landing
        return !document.hidden && !root.hidden && currentView === VIEWS.landing
    }

    function clearAttractionCycle(){
        if(attractionTimeout != null){
            window.clearTimeout(attractionTimeout)
            attractionTimeout = null
        }
        stopAnimation('playAttraction')
    }

    function scheduleAttraction(delay = 5200){
        if(attractionTimeout != null){
            window.clearTimeout(attractionTimeout)
            attractionTimeout = null
        }
        if(reducedMotion || anime == null || playButton.disabled || root.hasAttribute('data-launching') || !isHomeActive()){
            return
        }
        attractionTimeout = window.setTimeout(() => {
            attractionTimeout = null
            if(reducedMotion || playButton.disabled || root.hasAttribute('data-launching') || !isHomeActive()){
                return
            }
            const timeline = createSequence('playAttraction', { defaults: { ease: 'out(5)' } })
            if(timeline != null){
                timeline
                    .add(get('.sa-play-energy'), { opacity: [0, .95, 0], scale: [.9, 1.045, 1.08], duration: 680 }, 0)
                    .add(get('.sa-play-sheen'), { x: [0, 620], opacity: [.2, .88, 0], duration: 620 }, 40)
                    .add(get('.sa-play-icon'), { x: [0, 8, 0], scale: [1, 1.25, 1], duration: 440 }, 90)
                    .add(get('.sa-play-copy'), { x: [0, 5, 0], duration: 390 }, 120)
            }
            scheduleAttraction(7200)
        }, delay)
    }

    function runProgressSweep(){
        animateOnce('progressSweep', get('.sa-progress-scan'), {
            x: [0, 520],
            opacity: [0, .9, 0],
            duration: 920,
            ease: 'inOut(3)'
        })
    }

    function setText(selector, value, fallback = '--'){
        const element = get(selector)
        if(element != null){
            element.textContent = value == null || value === '' ? fallback : value
        }
    }

    function announce(message){
        if(liveRegion != null){
            liveRegion.textContent = message
        }
    }

    function setLegacyHidden(hidden){
        landing.classList.toggle('is-squad-arcade-ready', hidden)
        legacyLanding.forEach(element => {
            element.hidden = hidden
        })
    }

    function syncThemeControls(theme){
        getAll('[data-sa-theme]').forEach(option => {
            option.setAttribute('aria-checked', String(option.dataset.saTheme === theme))
        })
        themeTrigger.setAttribute('aria-label', `Cambiar tema. Tema actual: ${themes[theme]}`)
    }

    function applyTheme(theme, persist = true){
        const sanitizedTheme = Object.prototype.hasOwnProperty.call(themes, theme) ? theme : 'overworld'
        const changed = root.dataset.theme !== sanitizedTheme
        root.dataset.theme = sanitizedTheme
        syncThemeControls(sanitizedTheme)
        if(changed && persist){
            runThemePulse()
        }
        if(persist){
            ConfigManager.setLauncherTheme(sanitizedTheme)
            ConfigManager.save()
            announce(`Tema aplicado: ${themes[sanitizedTheme]}.`)
        }
    }

    async function openSettings(tabId){
        await prepareSettings()
        switchView(getCurrentView(), VIEWS.settings, 500, 500, () => {
            if(tabId != null){
                const tab = document.getElementById(tabId)
                if(tab != null){
                    settingsNavItemListener(tab, false)
                }
            }
        })
    }

    function updateServer(server){
        const rawServer = server?.rawServer
        const nextServerId = rawServer?.id || null
        const changed = currentServerId != null && nextServerId !== currentServerId
        setText('[data-sa-server-id]', rawServer?.id, 'SIN SELECCIÓN')
        setText('[data-sa-server-name]', rawServer?.name, 'Sin servidor')
        setText('[data-sa-server-description]', rawServer?.description, 'Elegí un servidor para jugar.')
        setText('[data-sa-minecraft-version]', rawServer?.minecraftVersion)
        setText('[data-sa-pack-version]', rawServer?.version)

        const icon = get('[data-sa-server-icon]')
        if(icon != null){
            icon.src = rawServer?.icon || 'assets/images/SealCircle.png'
            icon.alt = rawServer?.name ? `Icono de ${rawServer.name}` : ''
        }
        setEnabled(server != null)
        currentServerId = nextServerId
        if(changed){
            runServerSwap()
        }
    }

    function updateAccount(account){
        setText('[data-sa-account-name]', account?.displayName, 'Sin cuenta')
        const skin = get('[data-sa-skin]')
        if(skin != null){
            if(account?.uuid){
                skin.src = `https://mc-heads.net/body/${account.uuid}/right`
                skin.alt = `Skin de ${account.displayName || 'la cuenta seleccionada'}`
                skin.hidden = false
            } else {
                skin.removeAttribute('src')
                skin.alt = ''
                skin.hidden = true
            }
        }
    }

    function updateStatus(online, players){
        setText('[data-sa-status]', online ? 'ONLINE' : 'OFFLINE')
        setText('[data-sa-players]', online ? players : '--')
    }

    function setEnabled(enabled){
        playButton.disabled = !enabled
        if(!enabled){
            playReadyDetail.textContent = 'Esperando servidor'
            clearAttractionCycle()
        } else {
            playReadyDetail.textContent = 'Listo para iniciar'
            scheduleAttraction()
        }
    }

    function setLaunching(loading){
        const wasLaunching = root.hasAttribute('data-launching')
        root.toggleAttribute('data-launching', loading)
        if(loading){
            clearAttractionCycle()
            playButton.disabled = true
            playButton.setAttribute('aria-busy', 'true')
            lastProgressSweep = -10
            if(!wasLaunching){
                runLaunchReaction()
                runProgressSweep()
            }
        } else {
            playButton.removeAttribute('aria-busy')
            setEnabled(!document.getElementById('launch_button').disabled)
            progress.style.width = '0%'
            progressLabel.textContent = '0%'
            progressTrack.setAttribute('aria-valuenow', '0')
            stopAnimation('progressSweep')
        }
    }

    function setLaunchDetails(details){
        const value = details || 'Preparando partida'
        if(playDetail.textContent === value){
            return
        }
        playDetail.textContent = value
        announce(`Descarga: ${value}`)
        animateOnce('launchDetail', playDetail, {
            opacity: [.25, 1],
            x: [8, 0],
            duration: 240,
            ease: 'out(4)'
        })
    }

    function setLaunchPercentage(percent){
        const value = Math.max(0, Math.min(100, Number(percent) || 0))
        progress.style.width = `${value}%`
        progressLabel.textContent = `${value}%`
        progressTrack.setAttribute('aria-valuenow', String(value))
        if(root.hasAttribute('data-launching') && Math.abs(value - lastProgressSweep) >= 8){
            lastProgressSweep = value
            runProgressSweep()
        }
    }

    function bindActions(){
        playButton.addEventListener('click', () => {
            runPlayImpact()
            document.getElementById('launch_button')?.click()
        })
        get('[data-sa-select-server]').addEventListener('click', () => toggleServerSelection(true))
        getAll('[data-sa-open]').forEach(button => {
            button.addEventListener('click', async () => {
                const target = button.dataset.saOpen
                if(target === 'mods'){
                    await openSettings('settingsNavMods')
                } else if(target === 'account'){
                    await openSettings('settingsNavAccount')
                } else {
                    await openSettings()
                }
            })
        })

        themeTrigger.addEventListener('click', () => {
            themeDialog.showModal()
            get(`[data-sa-theme='${root.dataset.theme}']`)?.focus()
        })
        getAll('[data-sa-theme]').forEach(option => {
            option.addEventListener('click', () => applyTheme(option.dataset.saTheme))
        })
        getAll('[data-sa-theme-close]').forEach(button => {
            button.addEventListener('click', () => {
                themeDialog.close()
                themeTrigger.focus()
            })
        })
        themeDialog.addEventListener('click', event => {
            if(event.target === themeDialog){
                themeDialog.close()
                themeTrigger.focus()
            }
        })
        themeDialog.addEventListener('close', () => themeTrigger.focus())

        const youtube = get('[data-sa-youtube]')
        if(youtube?.getAttribute('href') === '#'){
            youtube.setAttribute('aria-disabled', 'true')
            youtube.setAttribute('tabindex', '-1')
            youtube.addEventListener('click', event => event.preventDefault())
        }

        motionPreference.addEventListener('change', event => {
            reducedMotion = event.matches
            if(reducedMotion){
                clearAttractionCycle()
                activeAnimations.forEach(animation => animation.complete(true))
                activeAnimations.clear()
            } else {
                scheduleAttraction()
            }
        })
        document.addEventListener('visibilitychange', () => {
            if(document.hidden){
                clearAttractionCycle()
            } else {
                scheduleAttraction()
            }
        })
        window.addEventListener('blur', clearAttractionCycle)
        window.addEventListener('focus', () => scheduleAttraction())
        if(window.MutationObserver != null){
            const homeObserver = new window.MutationObserver(() => {
                if(isHomeActive()){
                    scheduleAttraction()
                } else {
                    clearAttractionCycle()
                }
            })
            homeObserver.observe(landing, { attributes: true, attributeFilter: ['class', 'style'] })
        }
    }

    async function syncInitialState(){
        updateAccount(ConfigManager.getSelectedAccount())
        try {
            const distro = await DistroAPI.getDistribution()
            updateServer(distro.getServerById(ConfigManager.getSelectedServer()))
        } catch(err) {
            loggerLanding.warn('Unable to initialize Squad Arcade server data.', err)
        }
    }

    try {
        applyTheme(ConfigManager.getLauncherTheme(), false)
        bindActions()
        window.squadArcade = {
            updateServer,
            updateAccount,
            updateStatus,
            setEnabled,
            setLaunching,
            setLaunchDetails,
            setLaunchPercentage
        }
        root.hidden = false
        setLegacyHidden(true)
        runEntrance()
        syncInitialState()
    } catch(err) {
        root.hidden = true
        setLegacyHidden(false)
        console.error('Squad Arcade initialization failed. Restoring legacy Home.', err)
    }
})()

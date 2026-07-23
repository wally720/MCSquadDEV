/**
 * Finite cinematic controller for welcome.ejs.
 */
(function(){
    const INTRO_DURATION = 3600
    const INTRO_TIMEOUT = 4000
    const EXIT_DURATION = 999
    const EXIT_TIMEOUT = 1250

    function createSquadArcadeIntro(options = {}){
        const root = options.root || document.querySelector('[data-squad-arcade-intro]')
        if(root == null){
            return null
        }

        const get = selector => root.querySelector(selector)
        const getAll = selector => root.querySelectorAll(selector)
        const skipButton = get('[data-sai-skip]')
        const continueButton = get('[data-sai-continue]')
        const optOut = get('[data-sai-opt-out]')
        const liveRegion = get('[data-sai-live]')
        const status = get('[data-sai-status]')
        const logo = get('[data-sai-logo]')
        const configManager = options.configManager || ConfigManager
        const views = options.views || VIEWS
        const switchViewHandler = options.switchView || switchView
        const currentView = options.getCurrentView || getCurrentView
        const startupView = options.getStartupView || getStartupView
        const prepareLogin = options.prepareLoginOptions || prepareLoginOptionsForStartup
        const logger = options.logger || LoggerUtil.getLogger('Welcome')
        const motionPreference = options.motionPreference || window.matchMedia('(prefers-reduced-motion: reduce)')
        let anime = options.anime
        let timeline = null
        let ambientAnimations = []
        let hoverAnimation = null
        let exitAnimation = null
        let exitEffects = null
        let exitTimeout = null
        let safetyTimeout = null
        let started = false
        let finalShown = false
        let transitioning = false
        let runtimeReady = false
        let exitRequested = false
        let preferencePersisted = false
        let fatal = false
        let userMovedFocus = false
        let windowFocused = true
        let logoHovered = false
        let destroyed = false
        let continueExiting = false
        let reducedMotion = motionPreference.matches

        if(anime === undefined){
            try {
                anime = require('animejs')
            } catch (error){
                logger.warn('Anime.js is unavailable. Showing the static intro.', error)
                anime = null
            }
        }

        function clearSafetyTimeout(){
            if(safetyTimeout != null){
                window.clearTimeout(safetyTimeout)
                safetyTimeout = null
            }
        }

        function cancelTimeline(){
            if(timeline != null){
                timeline.cancel()
                timeline = null
            }
        }

        function cancelAnimation(animation){
            animation?.cancel()
        }

        function stopAmbient(){
            ambientAnimations.forEach(cancelAnimation)
            ambientAnimations = []
        }

        function cancelHover(){
            cancelAnimation(hoverAnimation)
            hoverAnimation = null
        }

        function clearExitTimeout(){
            if(exitTimeout != null){
                window.clearTimeout(exitTimeout)
                exitTimeout = null
            }
        }

        function cleanupExitEffects(){
            exitEffects?.container.remove()
            exitEffects = null
            root.removeAttribute('data-exploding')
        }

        function createExitEffects(){
            const container = document.createElement('div')
            container.className = 'sai-exit-effects'
            container.setAttribute('aria-hidden', 'true')
            const burst = document.createElement('span')
            burst.className = 'sai-exit-burst'
            container.appendChild(burst)

            const shards = Array.from({ length: 10 }, (_, index) => {
                const shard = document.createElement('i')
                const angle = (Math.PI * 2 * index / 10) - (Math.PI / 2)
                const distance = 155 + ((index % 3) * 34)
                shard.className = 'sai-exit-shard'
                shard.dataset.x = `${Math.round(Math.cos(angle) * distance)}px`
                shard.dataset.y = `${Math.round(Math.sin(angle) * distance)}px`
                shard.dataset.rotate = `${(index * 71) - 120}deg`
                container.appendChild(shard)
                return shard
            })

            const smoke = Array.from({ length: 6 }, (_, index) => {
                const cloud = document.createElement('i')
                const angle = (Math.PI * 2 * index / 6) - (Math.PI / 2)
                const distance = 58 + ((index % 2) * 26)
                cloud.className = 'sai-exit-smoke'
                cloud.dataset.x = `${Math.round(Math.cos(angle) * distance)}px`
                cloud.dataset.y = `${Math.round(Math.sin(angle) * distance)}px`
                container.appendChild(cloud)
                return cloud
            })

            root.appendChild(container)
            return { container, burst, shards, smoke }
        }

        function canAnimateFinal(){
            return finalShown && !destroyed && !fatal && !transitioning && !exitRequested && !reducedMotion
                && anime?.createTimeline != null && anime?.stagger != null
        }

        function buildAmbientAnimations(){
            const portalRings = getAll('.sai-portal-ring')
            const stormRings = getAll('.sai-storm-ring')
            const animations = []
            try {
                animations.push(anime.createTimeline({ loop: true, alternate: true, defaults: { ease: 'inOutSine' } })
                    .add(portalRings[0], { opacity: [.38, .68], scale: [.96, 1.08], rotate: [0, 55], duration: 5600 }, 0)
                    .add(portalRings[1], { opacity: [.52, .28], scale: [1.04, .94], rotate: [0, -72], duration: 6200 }, 0)
                    .add(stormRings, { opacity: [.16, .38], rotate: anime.stagger([28, -34]), duration: 6800 }, 0))

                animations.push(anime.createTimeline({ loop: true, alternate: true, defaults: { ease: 'inOutSine' } })
                    .add(get('.sai-seal-halo'), { opacity: [.58, 1], scale: [.96, 1.08], duration: 2400 }, 0)
                    .add(getAll('.sai-sky'), { opacity: [.66, .9], scale: [1, 1.025], duration: 4200 }, 0))

                animations.push(anime.createTimeline({ loop: true, defaults: { ease: 'inOut(3)' } })
                    .add(getAll('.sai-lightning path'), {
                        opacity: [.08, .52, .08],
                        strokeDashoffset: [280, 80],
                        delay: anime.stagger(120),
                        duration: 1100
                    }, 0)
                    .add(getAll('.sai-fragment'), {
                        opacity: [.12, .58, .12],
                        scale: [.82, 1.12, .82],
                        rotate: [-4, 5, -4],
                        delay: anime.stagger(80),
                        duration: 1200
                    }, 2300)
                    .add(getAll('.sai-convergence'), {
                        opacity: [.04, .3, .04],
                        scaleX: [.72, 1.08],
                        delay: anime.stagger(45),
                        duration: 700
                    }, 4700))
            } catch (error){
                animations.forEach(cancelAnimation)
                throw error
            }
            return animations
        }

        function startAmbient(){
            if(!canAnimateFinal() || ambientAnimations.length > 0 || document.hidden || !windowFocused){
                return
            }
            try {
                ambientAnimations = buildAmbientAnimations()
                root.setAttribute('data-ambient', '')
            } catch (error){
                stopAmbient()
                logger.warn('Unable to initialize the ambient intro effects.', error)
            }
        }

        function runLogoHover(){
            if(!canAnimateFinal() || document.hidden || !windowFocused){
                return
            }
            cancelHover()
            root.setAttribute('data-logo-hover', '')
            try {
                hoverAnimation = anime.createTimeline({ defaults: { ease: 'out(5)' } })
                    .add(get('.sai-portal'), { scale: [1, 1.46], rotate: [0, 24], duration: 420 }, 0)
                    .add(get('.sai-storm'), { scale: [1, 1.2], rotate: [0, -17], duration: 520 }, 0)
                    .add(get('.sai-impact'), { opacity: [0, .95, 0], scale: [.18, 2.2], duration: 620 }, 0)
                    .add(get('.sai-impact-line'), { opacity: [0, 1, 0], scaleX: [.12, 2.1], rotate: [-8, 4], duration: 520 }, 40)
                    .add(get('.sai-lightning'), { opacity: [.3, 1, .34], scale: [1, 1.06], rotate: [0, -2], duration: 560 }, 0)
                    .add(get('.sai-seal'), { scale: [1, 1.2, 1.08], rotate: [0, -7, 3], duration: 560 }, 0)
            } catch (error){
                cancelHover()
                root.removeAttribute('data-logo-hover')
                logger.warn('Unable to initialize the logo reaction.', error)
            }
        }

        function restoreLogoHover(){
            cancelHover()
            root.removeAttribute('data-logo-hover')
            if(!canAnimateFinal() || document.hidden || !windowFocused){
                return
            }
            hoverAnimation = anime.createTimeline({ defaults: { ease: 'out(4)' } })
                .add(get('.sai-portal'), { scale: 1, rotate: 0, duration: 620 }, 0)
                .add(get('.sai-storm'), { scale: 1, rotate: 0, duration: 620 }, 0)
                .add(get('.sai-lightning'), { opacity: 1, scale: 1, rotate: 0, duration: 520 }, 0)
                .add(get('.sai-seal'), { scale: 1, rotate: 0, duration: 520 }, 0)
        }

        function showFinal(cancelActive = true){
            if(finalShown || destroyed || fatal){
                return
            }
            finalShown = true
            clearSafetyTimeout()
            if(cancelActive){
                cancelTimeline()
            } else {
                timeline = null
            }
            root.setAttribute('data-final', '')
            skipButton.disabled = true
            updateRuntimeState()
            startAmbient()
            if(runtimeReady && !userMovedFocus){
                continueButton.focus()
            }
        }

        function updateRuntimeState(){
            if(runtimeReady){
                root.removeAttribute('data-waiting')
                status.textContent = 'LAUNCHER LISTO'
                continueButton.disabled = !finalShown || transitioning
                liveRegion.textContent = finalShown
                    ? 'Introduccion completada. Puedes continuar.'
                    : 'Launcher preparado.'
            } else {
                root.setAttribute('data-waiting', '')
                status.textContent = 'PREPARANDO LAUNCHER...'
                continueButton.disabled = true
                liveRegion.textContent = finalShown
                    ? 'Introduccion completada. Preparando launcher.'
                    : 'Preparando launcher.'
            }
        }

        function persistOptOut(){
            if(preferencePersisted || !optOut.checked){
                return
            }
            preferencePersisted = true
            try {
                configManager.setShowIntro(false)
                configManager.save()
            } catch (error){
                logger.warn('Unable to save the intro preference. Continuing navigation.', error)
            }
        }

        function navigateToStartup(){
            if(transitioning || fatal || destroyed){
                return
            }
            transitioning = true
            root.setAttribute('data-leaving', '')
            skipButton.disabled = true
            continueButton.disabled = true
            const destination = startupView()
            if(destination === views.loginOptions){
                prepareLogin()
            }
            destroy()
            switchViewHandler(currentView(), destination)
        }

        function requestExit(){
            if(exitRequested || transitioning || fatal){
                return
            }
            exitRequested = true
            clearSafetyTimeout()
            cancelTimeline()
            persistOptOut()
            showFinal(false)
            if(runtimeReady){
                navigateToStartup()
            }
        }

        function finishContinueExit(){
            if(destroyed || fatal || transitioning){
                return
            }
            exitAnimation = null
            clearExitTimeout()
            cleanupExitEffects()
            navigateToStartup()
        }

        function requestContinueExit(){
            if(exitRequested || transitioning || fatal || destroyed || !runtimeReady || !finalShown){
                return
            }
            exitRequested = true
            continueExiting = true
            clearSafetyTimeout()
            persistOptOut()
            skipButton.disabled = true
            continueButton.disabled = true
            stopAmbient()
            cancelHover()
            root.removeAttribute('data-ambient')
            root.removeAttribute('data-logo-hover')
            root.setAttribute('data-exploding', '')

            if(reducedMotion || anime?.createTimeline == null || anime?.stagger == null){
                finishContinueExit()
                return
            }

            try {
                exitEffects = createExitEffects()
                exitAnimation = anime.createTimeline({
                    defaults: { ease: 'out(5)' },
                    onComplete: finishContinueExit
                })
                    .add(continueButton, { scale: [1, .88, 1.08], duration: 169, ease: 'inOut(4)' }, 0)
                    .add(exitEffects.burst, { opacity: [0, 1, 0], scale: [.08, 2.5], duration: 709 }, 135)
                    .add(exitEffects.shards, {
                        opacity: [0, 1, 0],
                        translateX: target => target.dataset.x,
                        translateY: target => target.dataset.y,
                        rotate: target => target.dataset.rotate,
                        scale: [.42, 1.18, .78],
                        delay: anime.stagger(13),
                        duration: 713
                    }, 169)
                    .add(exitEffects.smoke, {
                        opacity: [0, .72, 0],
                        translateX: target => target.dataset.x,
                        translateY: target => target.dataset.y,
                        scale: [.45, 1.8],
                        delay: anime.stagger(24),
                        duration: 641,
                        ease: 'outSine'
                    }, 236)
                    .add(get('.sai-lockup'), { opacity: [1, 0], scale: [1, 1.08], translateY: [0, -10], duration: 726 }, 203)
                exitTimeout = window.setTimeout(finishContinueExit, EXIT_TIMEOUT)
            } catch (error){
                cancelAnimation(exitAnimation)
                exitAnimation = null
                cleanupExitEffects()
                logger.warn('Unable to initialize the intro exit effect. Continuing navigation.', error)
                finishContinueExit()
            }
        }

        function setRuntimeReady(){
            if(runtimeReady || fatal){
                return
            }
            runtimeReady = true
            updateRuntimeState()
            if(exitRequested){
                navigateToStartup()
            }
        }

        function cancelForFatal(){
            if(fatal){
                return
            }
            fatal = true
            clearSafetyTimeout()
            cancelTimeline()
            destroy()
            root.setAttribute('data-fatal', '')
        }

        function buildTimeline(){
            const sequence = anime.createTimeline({
                defaults: { ease: 'out(4)' },
                onComplete: () => showFinal(false)
            })

            sequence
                .add(getAll('.sai-sky'), { opacity: [.58, .9], scale: [1.08, 1], rotate: [-2, 2], duration: INTRO_DURATION, ease: 'linear' }, 0)
                .add(getAll('.sai-storm-ring'), { opacity: [0, .88, .2], scale: [.18, 1.08], rotate: [-140, 95], delay: anime.stagger(40), duration: 550 }, 0)
                .add(getAll('.sai-convergence'), { opacity: [0, .9, 0], scaleX: [.12, 1], delay: anime.stagger(20), duration: 450 }, 100)
                .add(getAll('.sai-lightning path'), { opacity: [0, 1, .15], strokeDashoffset: [420, 0], delay: anime.stagger(80), duration: 620, ease: 'inOut(3)' }, 350)
                .add(getAll('.sai-portal-ring'), { opacity: [0, .95, .2], scale: [1.8, .58], rotate: [0, 145], delay: anime.stagger(100), duration: 1100 }, 1050)
                .add(getAll('.sai-fragment'), { opacity: [0, 1, 0], scale: [1, .15], x: [0, -80], delay: anime.stagger(35), duration: 700, ease: 'in(4)' }, 1200)
                .add(get('.sai-impact'), { opacity: [0, .95, 0], scale: [.08, 1.8], duration: 550 }, 1900)
                .add(get('.sai-impact-line'), { opacity: [0, 1, 0], scaleX: [.1, 1.7], duration: 480 }, 1940)
                .add(get('.sai-seal-wrap'), { opacity: [0, 1], scale: [.25, 1.12, 1], rotate: [-18, 2, 0], duration: 1300 }, 1050)
                .add(get('.sai-copy'), { opacity: [0, 1], y: [24, 0], duration: 1000 }, 2200)
                .add(getAll('.sai-final-control'), { opacity: [0, 1], y: [12, 0], duration: 400 }, 3200)

            return sequence
        }

        function start(){
            if(started || transitioning || destroyed || fatal){
                return
            }
            started = true
            root.setAttribute('data-started', '')
            updateRuntimeState()
            if(reducedMotion || anime?.createTimeline == null || anime?.stagger == null){
                showFinal()
                return
            }
            try {
                timeline = buildTimeline()
                safetyTimeout = window.setTimeout(() => showFinal(), INTRO_TIMEOUT)
            } catch (error){
                logger.warn('Unable to initialize the cinematic intro. Showing the static intro.', error)
                showFinal()
            }
        }

        function onKeyDown(event){
            if(event.key === 'Tab'){
                userMovedFocus = true
            }
            if(event.key === 'Escape' && currentView() === views.welcome){
                event.preventDefault()
                requestExit()
            }
        }

        function onPointerDown(){
            userMovedFocus = true
        }

        function onMotionChange(event){
            reducedMotion = event.matches
            if(event.matches){
                if(continueExiting){
                    cancelAnimation(exitAnimation)
                    exitAnimation = null
                    finishContinueExit()
                    return
                }
                stopAmbient()
                cancelHover()
                root.removeAttribute('data-ambient')
                root.removeAttribute('data-logo-hover')
                if(started && !finalShown){
                    showFinal()
                }
            } else if(finalShown){
                startAmbient()
            }
        }

        function pauseActiveWork(){
            timeline?.pause()
            ambientAnimations.forEach(animation => animation.pause())
            hoverAnimation?.pause()
        }

        function resumeActiveWork(){
            if(timeline != null && !finalShown && !document.hidden && windowFocused){
                timeline.resume()
            }
            if(canAnimateFinal() && !document.hidden && windowFocused){
                if(ambientAnimations.length === 0){
                    startAmbient()
                } else {
                    ambientAnimations.forEach(animation => animation.resume())
                }
                if(hoverAnimation != null){
                    hoverAnimation.resume()
                } else if(logoHovered){
                    runLogoHover()
                }
            }
        }

        function onVisibilityChange(){
            if(document.hidden){
                pauseActiveWork()
            } else {
                resumeActiveWork()
            }
        }

        function onBlur(){
            windowFocused = false
            pauseActiveWork()
        }

        function onFocus(){
            windowFocused = true
            resumeActiveWork()
        }

        function onLogoEnter(){
            logoHovered = true
            runLogoHover()
        }

        function onLogoLeave(){
            logoHovered = false
            restoreLogoHover()
        }

        function destroy(){
            destroyed = true
            clearSafetyTimeout()
            clearExitTimeout()
            cancelTimeline()
            stopAmbient()
            cancelHover()
            cancelAnimation(exitAnimation)
            exitAnimation = null
            cleanupExitEffects()
            root.removeAttribute('data-ambient')
            root.removeAttribute('data-logo-hover')
            skipButton.removeEventListener('click', requestExit)
            continueButton.removeEventListener('click', requestContinueExit)
            document.removeEventListener('keydown', onKeyDown)
            document.removeEventListener('pointerdown', onPointerDown)
            document.removeEventListener('visibilitychange', onVisibilityChange)
            window.removeEventListener('blur', onBlur)
            window.removeEventListener('focus', onFocus)
            motionPreference.removeEventListener?.('change', onMotionChange)
            logo.removeEventListener('pointerenter', onLogoEnter)
            logo.removeEventListener('pointerleave', onLogoLeave)
        }

        skipButton.addEventListener('click', requestExit)
        continueButton.addEventListener('click', requestContinueExit)
        document.addEventListener('keydown', onKeyDown)
        document.addEventListener('pointerdown', onPointerDown)
        document.addEventListener('visibilitychange', onVisibilityChange)
        window.addEventListener('blur', onBlur)
        window.addEventListener('focus', onFocus)
        motionPreference.addEventListener?.('change', onMotionChange)
        logo.addEventListener('pointerenter', onLogoEnter)
        logo.addEventListener('pointerleave', onLogoLeave)

        return {
            duration: INTRO_DURATION,
            exitDuration: EXIT_DURATION,
            exitTimeout: EXIT_TIMEOUT,
            start,
            showFinal,
            leave: requestExit,
            setRuntimeReady,
            cancelForFatal,
            destroy,
            isFinal: () => finalShown,
            isRuntimeReady: () => runtimeReady,
            isTransitioning: () => transitioning,
            isExitRequested: () => exitRequested
        }
    }

    window.createSquadArcadeIntro = createSquadArcadeIntro
})()

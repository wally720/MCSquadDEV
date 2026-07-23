(() => {
    'use strict'

    const root = document.querySelector('[data-squad-arcade-settings]')
    if(root == null){
        return
    }

    const themes = new Set(['overworld', 'creeper', 'nether', 'ender'])
    const requiredIds = [
        'settingsContainerLeft',
        'settingsNavContainer',
        'settingsNavHeader',
        'settingsNavItemsContent',
        'settingsNavDone',
        'settingsContainerRight',
        'settingsTabAccount',
        'settingsTabMinecraft',
        'settingsTabMods',
        'settingsTabJava',
        'settingsTabLauncher',
        'settingsTabAbout',
        'settingsTabUpdate',
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
    const tabTargets = [
        'settingsTabAccount',
        'settingsTabMinecraft',
        'settingsTabMods',
        'settingsTabJava',
        'settingsTabLauncher',
        'settingsTabAbout',
        'settingsTabUpdate'
    ]
    const cleanup = []
    const observers = []
    const activeAnimations = new Map()
    const errorState = new WeakMap()
    let anime = null
    let motionPreference = null
    let reducedMotion = true
    let windowFocused = true
    let settingsVisible = root.style.display !== 'none'
    let initialized = false
    let destroyed = false
    let navItems = []
    let panels = []
    let tabList = null
    let liveRegion = null
    let doneButton = null
    let lastSelected = null

    function addListener(target, type, listener, bucket = cleanup){
        target.addEventListener(type, listener)
        bucket.push(() => target.removeEventListener(type, listener))
    }

    function captureInlineStyles(targets){
        return targets.map(target => ({
            target,
            opacity: target.style?.opacity || '',
            transform: target.style?.transform || ''
        }))
    }

    function restoreInlineStyles(styles){
        styles.forEach(({ target, opacity, transform }) => {
            if(target.style == null){
                return
            }
            target.style.opacity = opacity
            target.style.transform = transform
            if(!opacity){
                target.style.removeProperty?.('opacity')
            }
            if(!transform){
                target.style.removeProperty?.('transform')
            }
        })
    }

    function cancelAnimation(name){
        const record = activeAnimations.get(name)
        if(record != null){
            activeAnimations.delete(name)
            try {
                if(typeof record.animation.revert === 'function'){
                    record.animation.revert()
                } else {
                    record.animation.cancel?.()
                }
            } catch(_error) {
                try {
                    record.animation.cancel?.()
                } catch(_cancelError) {
                    // Inline restoration below is the final defensive fallback.
                }
            } finally {
                restoreInlineStyles(record.inlineStyles)
            }
        }
    }

    function cancelAllMotion(){
        for(const name of Array.from(activeAnimations.keys())){
            cancelAnimation(name)
        }
    }

    function canAnimate(){
        return !destroyed
            && anime?.animate != null
            && !reducedMotion
            && !document.hidden
            && windowFocused
            && settingsVisible
    }

    function animateOnce(name, targets, parameters){
        if(!canAnimate()){
            return null
        }
        const targetList = Array.from(Array.isArray(targets) ? targets : [targets]).filter(Boolean)
        if(targetList.length === 0 || targetList.some(target => target === document.activeElement && target.tagName === 'INPUT')){
            return null
        }
        cancelAnimation(name)
        const record = {
            animation: null,
            completed: false,
            inlineStyles: captureInlineStyles(targetList)
        }
        const onComplete = parameters.onComplete
        try {
            record.animation = anime.animate(targetList, {
                ...parameters,
                onComplete: () => {
                    record.completed = true
                    if(activeAnimations.get(name) === record){
                        activeAnimations.delete(name)
                    }
                    restoreInlineStyles(record.inlineStyles)
                    onComplete?.()
                }
            })
            if(!record.completed){
                activeAnimations.set(name, record)
            }
            return record.animation
        } catch(_error) {
            restoreInlineStyles(record.inlineStyles)
            anime = null
            cancelAllMotion()
            return null
        }
    }

    function runEntrance(){
        const selectedPanel = panels.find(panel => panel.getAttribute('aria-hidden') === 'false')
        animateOnce('entrance', [
            root.querySelector('#settingsContainerLeft'),
            root.querySelector('#settingsNavHeader'),
            ...navItems,
            selectedPanel?.firstElementChild
        ], {
            opacity: [0.68, 1],
            x: [-8, 0],
            duration: 260,
            ease: 'out(3)'
        })
    }

    function runTabMotion(panel){
        animateOnce('tab', panel?.firstElementChild, {
            opacity: [0.72, 1],
            x: [8, 0],
            duration: 180,
            ease: 'out(3)'
        })
    }

    function runErrorMotion(element){
        const target = element.closest?.('.settingsFieldContainer, #settingsGameResolutionContainer, .settingsFileSelContainer') || element
        animateOnce('error', target, {
            x: [0, -4, 4, -2, 0],
            duration: 220,
            ease: 'inOut(2)'
        })
    }

    function runDoneFeedback(name, parameters){
        animateOnce(name, doneButton, {
            duration: 120,
            ease: 'out(3)',
            ...parameters
        })
    }

    function disableShell(){
        root.classList.remove('is-squad-settings-ready')
        root.removeAttribute('data-theme')
    }

    function resetAccessibility(){
        const currentTabList = root.querySelector('.squadSettingsTabList')
        currentTabList?.removeAttribute('role')
        currentTabList?.removeAttribute('aria-label')
        root.querySelectorAll('.settingsNavItem').forEach(item => {
            item.removeAttribute('role')
            item.removeAttribute('aria-controls')
            item.removeAttribute('aria-selected')
            item.removeAttribute('tabindex')
        })
        tabTargets.forEach(id => {
            const panel = root.querySelector(`#${id}`)
            panel?.removeAttribute('role')
            panel?.removeAttribute('aria-labelledby')
            panel?.removeAttribute('aria-hidden')
            panel?.removeAttribute('tabindex')
        })
        root.querySelectorAll('[cValue]').forEach(element => element.removeAttribute('aria-invalid'))
        liveRegion?.setAttribute('hidden', '')
    }

    function validateShell(){
        if(requiredIds.some(id => root.querySelector(`#${id}`) == null)){
            return false
        }
        const currentNavItems = Array.from(root.querySelectorAll('.settingsNavItem'))
        if(currentNavItems.length !== tabTargets.length){
            return false
        }
        if(currentNavItems.some((item, index) => item.getAttribute('rSc') !== tabTargets[index])){
            return false
        }
        return tabTargets.every(id => {
            const tab = root.querySelector(`#${id}`)
            return tab?.firstElementChild?.classList.contains('settingsTabHeader') === true
        })
    }

    function announce(message){
        if(liveRegion != null){
            liveRegion.textContent = message
        }
    }

    function syncTabs(animateChange = true){
        const selected = navItems.find(item => item.hasAttribute('selected')) || navItems[0]
        navItems.forEach(item => {
            const active = item === selected
            item.setAttribute('aria-selected', String(active))
            item.setAttribute('tabindex', active ? '0' : '-1')
        })
        panels.forEach(panel => {
            panel.setAttribute('aria-hidden', String(panel.id !== selected.getAttribute('rSc')))
        })
        if(lastSelected !== selected){
            if(lastSelected != null){
                announce(`Sección activa: ${selected.textContent.trim()}.`)
                if(animateChange){
                    runTabMotion(root.querySelector(`#${selected.getAttribute('rSc')}`))
                }
            }
            lastSelected = selected
        }
    }

    function syncError(element, animateChange = true){
        const invalid = element.hasAttribute('error')
        const previous = errorState.get(element) === true
        element.setAttribute('aria-invalid', String(invalid))
        errorState.set(element, invalid)
        if(invalid && !previous){
            const label = element.getAttribute('aria-label') || element.id || 'Campo'
            announce(`${label}: valor inválido.`)
            if(animateChange){
                runErrorMotion(element)
            }
        } else if(!invalid && previous){
            const label = element.getAttribute('aria-label') || element.id || 'Campo'
            announce(`${label}: valor válido.`)
        }
    }

    function onTabKeydown(event){
        const current = event.target.closest?.('.settingsNavItem') || event.target
        const currentIndex = navItems.indexOf(current)
        if(currentIndex < 0){
            return
        }
        let nextIndex
        if(event.key === 'ArrowDown'){
            nextIndex = (currentIndex + 1) % navItems.length
        } else if(event.key === 'ArrowUp'){
            nextIndex = (currentIndex - 1 + navItems.length) % navItems.length
        } else if(event.key === 'Home'){
            nextIndex = 0
        } else if(event.key === 'End'){
            nextIndex = navItems.length - 1
        } else {
            return
        }
        event.preventDefault()
        navItems[nextIndex].focus()
        navItems[nextIndex].click()
    }

    function setupAccessibility(){
        tabList = root.querySelector('.squadSettingsTabList')
        liveRegion = root.querySelector('#settingsA11yStatus')
        doneButton = root.querySelector('#settingsNavDone')
        navItems = Array.from(root.querySelectorAll('.settingsNavItem'))
        panels = tabTargets.map(id => root.querySelector(`#${id}`))
        if(tabList == null || liveRegion == null || doneButton == null || panels.some(panel => panel == null)){
            throw new Error('Incomplete accessibility contract')
        }
        tabList.setAttribute('role', 'tablist')
        tabList.setAttribute('aria-label', 'Secciones de ajustes')
        navItems.forEach(item => {
            item.setAttribute('role', 'tab')
            item.setAttribute('aria-controls', item.getAttribute('rSc'))
        })
        panels.forEach((panel, index) => {
            panel.setAttribute('role', 'tabpanel')
            panel.setAttribute('aria-labelledby', navItems[index].id)
            panel.setAttribute('tabindex', '0')
        })
        liveRegion.removeAttribute('hidden')
        syncTabs(false)
        root.querySelectorAll('[cValue]').forEach(element => syncError(element, false))
        addListener(tabList, 'keydown', onTabKeydown)

        const selectedObserver = new MutationObserver(() => syncTabs())
        selectedObserver.observe(tabList, {
            attributes: true,
            attributeFilter: ['selected'],
            subtree: true
        })
        observers.push(selectedObserver)

        const errorObserver = new MutationObserver(mutations => {
            mutations.forEach(mutation => syncError(mutation.target))
        })
        errorObserver.observe(root, {
            attributes: true,
            attributeFilter: ['error'],
            subtree: true
        })
        observers.push(errorObserver)
    }

    function refresh(){
        if(destroyed){
            return false
        }
        try {
            if(!validateShell()){
                destroy()
                return false
            }
            const configuredTheme = ConfigManager.getLauncherTheme()
            const theme = themes.has(configuredTheme) ? configuredTheme : 'overworld'
            root.setAttribute('data-theme', theme)
            if(initialized){
                root.classList.add('is-squad-settings-ready')
            }
            return true
        } catch(_error) {
            destroy()
            return false
        }
    }

    function setupVisibilityObserver(){
        const visibilityObserver = new MutationObserver(() => {
            const wasVisible = settingsVisible
            settingsVisible = root.style.display !== 'none'
            if(!settingsVisible){
                cancelAllMotion()
                return
            }
            if(!refresh()){
                return
            }
            if(!wasVisible){
                runEntrance()
            }
        })
        visibilityObserver.observe(root, {
            attributes: true,
            attributeFilter: ['style']
        })
        observers.push(visibilityObserver)
    }

    function setupMotion(){
        const motionCleanup = []
        try {
            anime = require('animejs')
            if(anime?.animate == null){
                anime = null
                return
            }
            motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
            reducedMotion = motionPreference.matches
            const onMotionChange = event => {
                reducedMotion = event.matches
                if(reducedMotion){
                    cancelAllMotion()
                }
            }
            const onVisibilityChange = () => {
                if(document.hidden){
                    cancelAllMotion()
                }
            }
            const onBlur = () => {
                windowFocused = false
                cancelAllMotion()
            }
            const onFocus = () => {
                windowFocused = true
            }
            const onDonePointerDown = () => runDoneFeedback('donePointer', { scale: [0.97, 1] })
            const onDoneClick = () => runDoneFeedback('doneClick', { opacity: [0.72, 1] })
            addListener(document, 'visibilitychange', onVisibilityChange, motionCleanup)
            addListener(window, 'blur', onBlur, motionCleanup)
            addListener(window, 'focus', onFocus, motionCleanup)
            addListener(doneButton, 'pointerdown', onDonePointerDown, motionCleanup)
            addListener(doneButton, 'click', onDoneClick, motionCleanup)
            motionPreference.addEventListener?.('change', onMotionChange)
            motionCleanup.push(() => motionPreference.removeEventListener?.('change', onMotionChange))
            cleanup.push(...motionCleanup)
        } catch(_error) {
            motionCleanup.forEach(remove => remove())
            anime = null
            reducedMotion = true
            cancelAllMotion()
        }
    }

    function destroy(){
        if(destroyed){
            return
        }
        destroyed = true
        cancelAllMotion()
        observers.splice(0).forEach(observer => observer.disconnect())
        cleanup.splice(0).forEach(remove => remove())
        resetAccessibility()
        disableShell()
    }

    window.squadArcadeSettings = Object.freeze({ refresh, destroy })
    try {
        if(!validateShell()){
            destroy()
            return
        }
        setupAccessibility()
        setupVisibilityObserver()
        initialized = true
        if(!refresh()){
            return
        }
        setupMotion()
    } catch(_error) {
        destroy()
    }
})()

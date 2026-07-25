(() => {
    'use strict'

    const root = document.querySelector('[data-squad-arcade-settings]')
    if(root == null){
        return
    }

    const essentialIds = [
        'settingsTabMods',
        'settingsModsContainer',
        'settingsReqModsContainer',
        'settingsReqModsContent',
        'settingsOptModsContainer',
        'settingsOptModsContent',
        'settingsDropinModsContainer',
        'settingsDropinFileSystemButton',
        'settingsDropinModsContent',
        'settingsShadersContainer',
        'settingsShaderpackDesc',
        'settingsShaderpackButton',
        'settingsShadersSelected',
        'settingsShadersOptions'
    ]
    const cleanup = []
    const observers = []
    const managedAttributes = new WeakMap()
    const managedElements = []
    const originalDisabled = new WeakMap()
    const seenRows = new WeakSet()
    const pendingRows = new Set()
    let tab = null
    let modsContainer = null
    let shaderSelected = null
    let shaderOptions = null
    let liveRegion = null
    let anime = null
    let activeAnimation = null
    let animationStyles = []
    let motionPreference = null
    let reducedMotion = true
    let windowFocused = true
    let dragging = false
    let suppressNextBatch = false
    let frame = null
    let pendingMotion = false
    let initialized = false
    let destroyed = false

    function addListener(target, type, listener){
        target.addEventListener(type, listener)
        cleanup.push(() => target.removeEventListener(type, listener))
    }

    function rememberAttribute(element, name){
        let attributes = managedAttributes.get(element)
        if(attributes == null){
            attributes = new Map()
            managedAttributes.set(element, attributes)
            managedElements.push(element)
        }
        if(!attributes.has(name)){
            attributes.set(name, element.hasAttribute(name) ? element.getAttribute(name) : null)
        }
    }

    function setManagedAttribute(element, name, value = ''){
        if(element == null){
            return
        }
        rememberAttribute(element, name)
        element.setAttribute(name, String(value))
    }

    function restoreManagedState(){
        managedElements.splice(0).forEach(element => {
            managedAttributes.get(element)?.forEach((value, name) => {
                if(value == null){
                    element.removeAttribute(name)
                } else {
                    element.setAttribute(name, value)
                }
            })
            if(originalDisabled.has(element)){
                element.disabled = originalDisabled.get(element)
            }
        })
    }

    function validate(){
        if(!root.classList.contains('is-squad-settings-ready')){
            return false
        }
        if(essentialIds.some(id => root.querySelector(`#${id}`) == null)){
            return false
        }
        tab = root.querySelector('#settingsTabMods')
        modsContainer = root.querySelector('#settingsModsContainer')
        shaderSelected = root.querySelector('#settingsShadersSelected')
        shaderOptions = root.querySelector('#settingsShadersOptions')
        liveRegion = root.querySelector('#settingsA11yStatus')
        return tab?.firstElementChild?.classList.contains('settingsTabHeader') === true
    }

    function textFor(card){
        return card?.querySelector('.settingsModName')?.textContent?.trim() || 'Módulo'
    }

    function stateText(enabled){
        return enabled ? 'Activado' : 'Desactivado'
    }

    function setState(card, input, enabled, prefix = ''){
        const name = textFor(card)
        const state = stateText(enabled)
        setManagedAttribute(input, 'aria-label', `${prefix}${name}: ${state}`)
        setManagedAttribute(card?.querySelector('.settingsModDetails'), 'data-sa-state', state)
    }

    function enhanceRequired(){
        tab.querySelectorAll('label[reqmod]').forEach(label => {
            const input = label.querySelector('input[type="checkbox"]')
            if(input == null){
                return
            }
            const card = label.closest('.settingsBaseMod')
            if(!originalDisabled.has(input)){
                originalDisabled.set(input, input.disabled)
            }
            input.disabled = true
            setManagedAttribute(input, 'aria-disabled', 'true')
            setManagedAttribute(input, 'tabindex', '-1')
            setManagedAttribute(input, 'aria-label', `${textFor(card)}: REQUERIDO, ${stateText(input.checked)}`)
            setManagedAttribute(label, 'data-sa-required-label', 'REQUERIDO')
            setManagedAttribute(card, 'data-sa-required', '')
            setManagedAttribute(card?.querySelector('.settingsModDetails'), 'data-sa-state', 'REQUERIDO')
        })
    }

    function enhanceOptional(){
        tab.querySelectorAll('input[formod]:not([dropin])').forEach(input => {
            const card = input.closest('.settingsBaseMod')
            const enabled = input.checked === true && card?.hasAttribute('enabled') === true
            setState(card, input, enabled)
        })
    }

    function enhanceDropins(){
        tab.querySelectorAll('input[formod][dropin]').forEach(input => {
            const card = input.closest('.settingsDropinMod') || input.closest('.settingsBaseMod')
            const disabled = card?.id?.endsWith('.disabled') === true
            setState(card, input, !disabled, 'Archivo externo ')
            const remove = card?.querySelector('[remmod]')
            setManagedAttribute(remove, 'aria-label', `Eliminar ${textFor(card)} inmediatamente`)
        })
    }

    function syncShaderAria(){
        const expanded = !shaderOptions.hasAttribute('hidden')
        setManagedAttribute(shaderSelected, 'aria-expanded', String(expanded))
        const options = Array.from(shaderOptions.children)
        options.forEach((option, index) => {
            setManagedAttribute(option, 'role', 'option')
            setManagedAttribute(option, 'tabindex', '-1')
            setManagedAttribute(option, 'aria-selected', String(option.hasAttribute('selected')))
            if(option.getAttribute('value') === 'OFF'){
                setManagedAttribute(option, 'aria-label', 'Shaders desactivados')
            } else if(!option.hasAttribute('aria-label')){
                setManagedAttribute(option, 'aria-label', option.textContent?.trim() || `Shader ${index + 1}`)
            }
        })
    }

    function enhanceShader(){
        setManagedAttribute(shaderSelected, 'role', 'combobox')
        setManagedAttribute(shaderSelected, 'tabindex', '0')
        setManagedAttribute(shaderSelected, 'aria-haspopup', 'listbox')
        setManagedAttribute(shaderSelected, 'aria-controls', 'settingsShadersOptions')
        setManagedAttribute(shaderSelected, 'aria-label', 'Shaderpack seleccionado')
        setManagedAttribute(shaderOptions, 'role', 'listbox')
        setManagedAttribute(shaderOptions, 'aria-label', 'Shaderpacks disponibles')
        syncShaderAria()
    }

    function enhanceDropZones(){
        const modsButton = root.querySelector('#settingsDropinFileSystemButton')
        const shaderButton = root.querySelector('#settingsShaderpackButton')
        setManagedAttribute(modsButton, 'aria-label', 'Abrir carpeta de mods externos. También acepta archivos arrastrados.')
        setManagedAttribute(modsButton, 'aria-describedby', 'settingsDropinRefreshNote')
        setManagedAttribute(shaderButton, 'aria-label', 'Abrir carpeta de shaderpacks. También acepta archivos arrastrados.')
        setManagedAttribute(shaderButton, 'aria-describedby', 'settingsShaderpackDesc')
    }

    function captureStyles(targets){
        return targets.map(target => ({
            target,
            opacity: target.style.opacity || '',
            transform: target.style.transform || ''
        }))
    }

    function restoreStyles(styles){
        styles.forEach(({ target, opacity, transform }) => {
            target.style.opacity = opacity
            target.style.transform = transform
            if(!opacity) target.style.removeProperty?.('opacity')
            if(!transform) target.style.removeProperty?.('transform')
        })
    }

    function cancelMotion(){
        if(activeAnimation != null){
            try {
                if(typeof activeAnimation.revert === 'function'){
                    activeAnimation.revert()
                } else {
                    activeAnimation.cancel?.()
                }
            } catch(_error) {
                try {
                    activeAnimation.cancel?.()
                } catch(_cancelError) {
                    // Style restoration below is the final fallback.
                }
            }
            activeAnimation = null
        }
        restoreStyles(animationStyles)
        animationStyles = []
    }

    function tabIsVisible(){
        return root.style.display !== 'none'
            && tab.style.display !== 'none'
            && tab.getAttribute('aria-hidden') !== 'true'
    }

    function animateRows(rows){
        if(rows.length === 0 || destroyed || dragging || reducedMotion || document.hidden || !windowFocused || !tabIsVisible() || anime?.animate == null){
            return false
        }
        cancelMotion()
        animationStyles = captureStyles(rows)
        let completed = false
        try {
            const record = anime.animate(rows, {
                opacity: [0.55, 1],
                y: [7, 0],
                duration: 190,
                delay: (_target, index) => index * 24,
                ease: 'out(3)',
                onComplete: () => {
                    completed = true
                    activeAnimation = null
                    restoreStyles(animationStyles)
                    animationStyles = []
                }
            })
            if(!completed){
                activeAnimation = record
            }
            return true
        } catch(_error) {
            anime = null
            cancelMotion()
            return false
        }
    }

    function enhance(animateNewRows = false, discardNewRows = false){
        if(destroyed || !validate()){
            destroy()
            return false
        }
        const discoveredRows = []
        tab.querySelectorAll('.settingsBaseMod').forEach(row => {
            if(!seenRows.has(row)){
                seenRows.add(row)
                pendingRows.add(row)
                discoveredRows.push(row)
            }
        })
        enhanceRequired()
        enhanceOptional()
        enhanceDropins()
        enhanceShader()
        enhanceDropZones()
        tab.classList.add('is-squad-mods-ready')
        if(discardNewRows){
            discoveredRows.forEach(row => pendingRows.delete(row))
        }
        if(animateNewRows){
            const currentRows = new Set(tab.querySelectorAll('.settingsBaseMod'))
            const rowsToAnimate = [...pendingRows].filter(row => currentRows.has(row))
            if(animateRows(rowsToAnimate)){
                rowsToAnimate.forEach(row => pendingRows.delete(row))
            }
        }
        return true
    }

    function scheduleEnhance(animateNewRows){
        pendingMotion = pendingMotion || animateNewRows
        if(frame != null || destroyed){
            return
        }
        frame = window.requestAnimationFrame(() => {
            frame = null
            const discard = suppressNextBatch
            const animate = pendingMotion && !discard
            pendingMotion = false
            suppressNextBatch = false
            enhance(animate, discard)
        })
    }

    function onTabChange(){
        cancelMotion()
        suppressNextBatch = true
        scheduleEnhance(false)
    }

    function onShaderKeydown(event){
        if(!['Enter', ' ', 'ArrowDown'].includes(event.key)){
            return
        }
        event.preventDefault()
        shaderSelected.click()
        syncShaderAria()
        if(event.key === 'ArrowDown'){
            const selectedOption = Array.from(shaderOptions.children).find(option => option.hasAttribute('selected')) || shaderOptions.children[0]
            selectedOption?.focus()
        }
    }

    function onOptionKeydown(event){
        const options = Array.from(shaderOptions.children)
        const current = event.target.closest?.('[role="option"]') || event.target
        const index = options.indexOf(current)
        if(index < 0){
            return
        }
        if(event.key === 'Enter' || event.key === ' '){
            event.preventDefault()
            current.click()
            syncShaderAria()
        } else if(event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End'){
            event.preventDefault()
            let next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : index + (event.key === 'ArrowDown' ? 1 : -1)
            next = (next + options.length) % options.length
            options[next]?.focus()
        } else if(event.key === 'Escape'){
            event.preventDefault()
            shaderSelected.click()
            shaderSelected.focus()
            syncShaderAria()
        }
    }

    function setupListeners(){
        addListener(tab, 'change', onTabChange)
        addListener(tab, 'input', onTabChange)
        addListener(tab, 'click', cancelMotion)
        addListener(tab, 'scroll', cancelMotion)
        addListener(shaderSelected, 'keydown', onShaderKeydown)
        addListener(shaderOptions, 'keydown', onOptionKeydown)
        const doneButton = root.querySelector('#settingsNavDone')
        const switchButton = tab.querySelector('.settingsSwitchServerButton')
        if(doneButton != null) addListener(doneButton, 'click', cancelMotion)
        if(switchButton != null) addListener(switchButton, 'click', cancelMotion)

        const dropTargets = [root.querySelector('#settingsDropinFileSystemButton'), root.querySelector('#settingsShaderpackButton')]
        dropTargets.forEach(button => {
            const onDragEnter = () => {
                dragging = true
                cancelMotion()
            }
            const onDragLeave = () => { dragging = false }
            const onDrop = () => {
                dragging = false
                suppressNextBatch = true
                cancelMotion()
            }
            addListener(button, 'dragenter', onDragEnter)
            addListener(button, 'dragleave', onDragLeave)
            addListener(button, 'drop', onDrop)
        })
    }

    function setupObservers(){
        const renderObserver = new MutationObserver(mutations => {
            const hasNewNodes = mutations.some(mutation => mutation.type === 'childList' && mutation.addedNodes.length > 0)
            scheduleEnhance(hasNewNodes)
        })
        renderObserver.observe(tab, {
            attributes: true,
            attributeFilter: ['enabled', 'hidden', 'selected'],
            childList: true,
            subtree: true
        })
        observers.push(renderObserver)

        const lifecycleObserver = new MutationObserver(() => {
            if(!validate()){
                destroy()
            } else if(!tabIsVisible()){
                cancelMotion()
            } else {
                scheduleEnhance(true)
            }
        })
        lifecycleObserver.observe(root, { attributes: true, attributeFilter: ['class', 'style'] })
        lifecycleObserver.observe(tab, { attributes: true, attributeFilter: ['aria-hidden', 'style'] })
        observers.push(lifecycleObserver)
    }

    function setupMotion(){
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
                if(reducedMotion) cancelMotion()
            }
            const onVisibilityChange = () => {
                if(document.hidden) cancelMotion()
            }
            const onBlur = () => {
                windowFocused = false
                cancelMotion()
            }
            const onFocus = () => { windowFocused = true }
            addListener(document, 'visibilitychange', onVisibilityChange)
            addListener(window, 'blur', onBlur)
            addListener(window, 'focus', onFocus)
            motionPreference.addEventListener?.('change', onMotionChange)
            cleanup.push(() => motionPreference.removeEventListener?.('change', onMotionChange))
        } catch(_error) {
            anime = null
            reducedMotion = true
        }
    }

    function refresh(){
        if(destroyed || !validate()){
            destroy()
            return false
        }
        return enhance(false)
    }

    function destroy(){
        if(destroyed){
            return
        }
        destroyed = true
        if(frame != null){
            window.cancelAnimationFrame(frame)
            frame = null
        }
        cancelMotion()
        observers.splice(0).forEach(observer => observer.disconnect())
        cleanup.splice(0).forEach(remove => remove())
        pendingRows.clear()
        restoreManagedState()
        tab?.classList.remove('is-squad-mods-ready')
    }

    window.squadArcadeSettingsMods = Object.freeze({ refresh, destroy })
    try {
        if(!validate()){
            return
        }
        setupMotion()
        setupListeners()
        setupObservers()
        initialized = enhance(true)
        if(initialized && liveRegion != null){
            liveRegion.textContent = 'Rack de equipamiento preparado.'
        }
    } catch(_error) {
        destroy()
    }
})()

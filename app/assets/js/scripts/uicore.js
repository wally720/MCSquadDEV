/**
 * Core UI functions are initialized in this file. This prevents
 * unexpected errors from breaking the core features. Specifically,
 * actions in this file should not require the usage of any internal
 * modules, excluding dependencies.
 */
// Requirements
const $                              = require('jquery')
const {ipcRenderer, shell, webFrame} = require('electron')
const remote                         = require('@electron/remote')
const isDev                          = require('./assets/js/isdev')
const { LoggerUtil }                 = require('helios-core')
const Lang                           = require('./assets/js/langloader')

const loggerUICore             = LoggerUtil.getLogger('UICore')
const loggerAutoUpdater        = LoggerUtil.getLogger('AutoUpdater')

// Log deprecation and process warnings.
process.traceProcessWarnings = true
process.traceDeprecation = true

// Disable eval function.
window.eval = global.eval = function () {
    throw new Error('Sorry, this app does not support window.eval().')
}

// Display warning when devtools window is opened.
remote.getCurrentWebContents().on('devtools-opened', () => {
    console.log('%cThe console is dark and full of terrors.', 'color: white; -webkit-text-stroke: 4px #a02d2a; font-size: 60px; font-weight: bold')
    console.log('%cIf you\'ve been told to paste something here, you\'re being scammed.', 'font-size: 16px')
    console.log('%cUnless you know exactly what you\'re doing, close this window.', 'font-size: 16px')
})

// Disable zoom, needed for darwin.
webFrame.setZoomLevel(0)
webFrame.setVisualZoomLevelLimits(1, 1)

// Initialize auto updates in production environments.
let updateCheckListener

function handleAutoUpdateNotification(arg, info){
    switch(arg){
        case 'checking-for-update':
            loggerAutoUpdater.info('Checking for update..')
            setTransientUpdateButtonStatus(Lang.queryJS('uicore.autoUpdate.checkingForUpdateButton'), true)
            break
        case 'update-available':
            loggerAutoUpdater.info('New update available', info.version)

            if(process.platform === 'darwin'){
                info.darwindownload = `https://github.com/wally720/mcsquaddev/releases/download/v${info.version}/MCSquad-Dev-setup-${info.version}${process.arch === 'arm64' ? '-arm64' : '-x64'}.dmg`
            }
            showUpdateUI(info)
            populateSettingsUpdateInformation(info)
            break
        case 'update-downloaded':
            loggerAutoUpdater.info('Update ' + info.version + ' ready to be installed.')
            settingsUpdateButtonStatus(Lang.queryJS('uicore.autoUpdate.installNowButton'), false, () => {
                if(!isDev){
                    ipcRenderer.send('autoUpdateAction', 'installUpdateNow')
                }
            })
            showUpdateUI(info, 'ready')
            break
        case 'update-not-available':
            loggerAutoUpdater.info('No new update found.')
            setTransientUpdateButtonStatus(Lang.queryJS('uicore.autoUpdate.checkForUpdatesButton'))
            clearTransientUpdateUI()
            break
        case 'ready':
            updateCheckListener = setInterval(() => {
                ipcRenderer.send('autoUpdateAction', 'checkForUpdate')
            }, 1800000)
            ipcRenderer.send('autoUpdateAction', 'checkForUpdate')
            break
        case 'realerror':
            if(updateUIState !== 'ready'){
                clearTransientUpdateUI()
                restoreUpdateCheckButton()
            }
            if(info != null && info.code != null){
                if(info.code === 'ERR_UPDATER_INVALID_RELEASE_FEED'){
                    loggerAutoUpdater.info('No suitable releases found.')
                } else if(info.code === 'ERR_XML_MISSED_ELEMENT'){
                    loggerAutoUpdater.info('No releases found.')
                } else {
                    loggerAutoUpdater.error('Error during update check..', info)
                    loggerAutoUpdater.debug('Error Code:', info.code)
                }
            }
            break
        default:
            loggerAutoUpdater.info('Unknown argument', arg)
            break
    }
}

if(!isDev){
    ipcRenderer.on('autoUpdateNotification', (event, arg, info) => {
        handleAutoUpdateNotification(arg, info)
    })
}

/**
 * Send a notification to the main process changing the value of
 * allowPrerelease. If we are running a prerelease version, then
 * this will always be set to true, regardless of the current value
 * of val.
 *
 * @param {boolean} val The new allow prerelease value.
 */
function changeAllowPrerelease(val){
    ipcRenderer.send('autoUpdateAction', 'allowPrereleaseChange', val)
}

function renderUpdateUI(){
    const labelKeys = {
        available: 'uicore.autoUpdate.availableStatus',
        downloading: 'uicore.autoUpdate.downloadingStatus',
        ready: 'uicore.autoUpdate.readyStatus'
    }
    const label = labelKeys[updateUIState] != null ? Lang.queryJS(labelKeys[updateUIState]) : null
    const active = label != null
    const updateNav = document.getElementById('settingsNavUpdate')
    const updateIndicator = document.getElementById('settingsUpdateAvailableIndicator')
    const updateBadge = document.querySelector('[data-sa-update-badge]')
    const updateBrand = document.querySelector('.sa-brand')

    if(updateNav != null){
        if(active){
            updateNav.setAttribute('update', '')
            if(updateIndicator != null){
                updateNav.setAttribute('aria-describedby', updateIndicator.id)
            }
            updateNav.setAttribute('data-update-state', updateUIState)
        } else {
            updateNav.removeAttribute('update')
            updateNav.removeAttribute('aria-describedby')
            updateNav.removeAttribute('data-update-state')
        }
    }
    if(updateIndicator != null){
        updateIndicator.hidden = !active
        if(active){
            updateIndicator.textContent = label
            updateIndicator.setAttribute('aria-label', label)
            updateIndicator.setAttribute('data-update-state', updateUIState)
        } else {
            updateIndicator.textContent = ''
            updateIndicator.removeAttribute('aria-label')
            updateIndicator.removeAttribute('data-update-state')
        }
    }
    if(updateBadge != null){
        updateBadge.hidden = !active
        if(active){
            updateBadge.setAttribute('aria-label', label)
            updateBadge.setAttribute('data-update-state', updateUIState)
            const badgeLabel = updateBadge.querySelector('[data-sa-update-label]')
            if(badgeLabel != null){
                badgeLabel.textContent = label
            }
        } else {
            updateBadge.removeAttribute('aria-label')
            updateBadge.removeAttribute('data-update-state')
        }
    }
    if(updateBrand != null){
        if(active){
            updateBrand.setAttribute('data-update-state', updateUIState)
        } else {
            updateBrand.removeAttribute('data-update-state')
        }
    }
}

let updateUIState = 'normal'

function setUpdateUIState(state){
    updateUIState = ['available', 'downloading', 'ready'].includes(state) ? state : 'normal'
    renderUpdateUI()
}

function setTransientUpdateButtonStatus(text, disabled = false){
    if(updateUIState !== 'ready'){
        settingsUpdateButtonStatus(text, disabled)
    }
}

function restoreUpdateCheckButton(){
    settingsUpdateButtonStatus(Lang.queryJS('uicore.autoUpdate.checkForUpdatesButton'), false, () => {
        if(!isDev){
            ipcRenderer.send('autoUpdateAction', 'checkForUpdate')
            settingsUpdateButtonStatus(Lang.queryJS('uicore.autoUpdate.checkingForUpdateButton'), true)
        }
    })
}

function showUpdateUI(info, state = process.platform === 'darwin' ? 'available' : 'downloading'){
    setUpdateUIState(info?.state || state)
}

function clearUpdateUI(){
    setUpdateUIState('normal')
}

function clearTransientUpdateUI(){
    if(updateUIState !== 'ready'){
        clearUpdateUI()
    }
}

/* jQuery Example
$(function(){
    loggerUICore.info('UICore Initialized');
})*/

document.addEventListener('readystatechange', function () {
    if (document.readyState === 'interactive'){
        loggerUICore.info('UICore Initializing..')
        renderUpdateUI()

        // Bind close button.
        Array.from(document.getElementsByClassName('fCb')).map((val) => {
            val.addEventListener('click', e => {
                const window = remote.getCurrentWindow()
                window.close()
            })
        })

        // Bind restore down button.
        Array.from(document.getElementsByClassName('fRb')).map((val) => {
            val.addEventListener('click', e => {
                const window = remote.getCurrentWindow()
                if(window.isMaximized()){
                    window.unmaximize()
                } else {
                    window.maximize()
                }
                document.activeElement.blur()
            })
        })

        // Bind minimize button.
        Array.from(document.getElementsByClassName('fMb')).map((val) => {
            val.addEventListener('click', e => {
                const window = remote.getCurrentWindow()
                window.minimize()
                document.activeElement.blur()
            })
        })

    }

}, false)

/**
 * Open web links in the user's default browser.
 */
$(document).on('click', 'a[href^="http"]', function(event) {
    event.preventDefault()
    shell.openExternal(this.href)
})

/**
 * Opens DevTools window if you hold (ctrl + shift + i).
 * This will crash the program if you are using multiple
 * DevTools, for example the chrome debugger in VS Code.
 */
document.addEventListener('keydown', function (e) {
    if((e.key === 'I' || e.key === 'i') && e.ctrlKey && e.shiftKey){
        let window = remote.getCurrentWindow()
        window.toggleDevTools()
    }
})

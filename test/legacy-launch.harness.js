const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')

const projectRoot = path.join(__dirname, '..')
const landingSource = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'js', 'scripts', 'landing.js'), 'utf8')
const landingMarkup = fs.readFileSync(path.join(projectRoot, 'app', 'landing.ejs'), 'utf8')
const uiCoreSource = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'js', 'scripts', 'uicore.js'), 'utf8')
const launcherStyles = fs.readFileSync(path.join(projectRoot, 'app', 'assets', 'css', 'launcher.css'), 'utf8')
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'legacy-characterization.json'), 'utf8'))

function extractFunction(source, name){
    const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source)
    assert.ok(match, `missing function ${name}`)
    const bodyStart = source.indexOf('{', match.index)
    let depth = 0
    let quote = null
    let escaped = false
    let lineComment = false
    let blockComment = false
    for(let index = bodyStart; index < source.length; index++){
        const char = source[index]
        const next = source[index + 1]
        if(lineComment){ if(char === '\n') lineComment = false; continue }
        if(blockComment){ if(char === '*' && next === '/'){ blockComment = false; index++ } continue }
        if(quote != null){
            if(escaped) escaped = false
            else if(char === '\\') escaped = true
            else if(char === quote) quote = null
            continue
        }
        if(char === '/' && next === '/'){ lineComment = true; index++ }
        else if(char === '/' && next === '*'){ blockComment = true; index++ }
        else if(char === '\'' || char === '"' || char === '`') quote = char
        else if(char === '{') depth++
        else if(char === '}' && --depth === 0) return source.slice(match.index, index + 1)
    }
    assert.fail(`unterminated function ${name}`)
}

function loadFunctions(names, context = {}, prelude = ''){
    const sandbox = vm.createContext({ console, ...context })
    const functions = names.map(name => extractFunction(landingSource, name)).join('\n')
    vm.runInContext(`${prelude}\n${functions}\nglobalThis.__sut = { ${names.join(', ')} }`, sandbox)
    return { context: sandbox, ...sandbox.__sut }
}

function launchStatePrelude(){
    return landingSource.slice(
        landingSource.indexOf('const launchState ='),
        landingSource.indexOf('function toggleLaunchArea')
    )
}

let scenarios = 0
async function scenario(name, test){
    await test()
    scenarios++
    console.log(`PASS ${name}`)
}

function language(){
    return { queryJS: key => key }
}

function knownGap(id){
    const gap = manifest.knownGaps.find(item => item.id === id)
    assert.ok(gap, `missing known gap fixture ${id}`)
    return gap
}

async function testProgressParity(){
    const calls = []
    const taskbar = []
    const window = { squadArcade: {
        setEnabled: value => calls.push(['enabled', value]),
        setLaunching: value => calls.push(['launching', value]),
        setLaunchDetails: value => calls.push(['details', value]),
        setLaunchPercentage: value => calls.push(['progress', value])
    } }
    const sut = loadFunctions(['toggleLaunchArea', 'setLaunchDetails', 'setLaunchPercentage', 'setDownloadPercentage', 'setLaunchEnabled', 'showLaunchFailure'], {
        remote: { getCurrentWindow: () => ({ setProgressBar: value => taskbar.push(value) }) },
        window,
        Lang: language(),
        setOverlayContent: (...args) => calls.push(['failure', ...args]),
        setOverlayHandler: () => calls.push(['overlayHandler']),
        toggleOverlay: value => calls.push(['overlay', value])
    }, launchStatePrelude())
    assert.equal(window.getLaunchState().enabled, false)
    assert.equal(window.getLaunchState().launching, false)
    sut.setLaunchEnabled(true)
    sut.toggleLaunchArea(true)
    sut.setLaunchEnabled(true)
    sut.setLaunchDetails('Verifying')
    sut.setDownloadPercentage(0)
    sut.setDownloadPercentage(37)
    sut.setDownloadPercentage(100)
    sut.showLaunchFailure('Failure', 'Description')
    assert.equal(window.getLaunchState().enabled, true)
    assert.equal(window.getLaunchState().launching, false)
    assert.equal(window.getLaunchProgress().details, 'Verifying')
    assert.equal(window.getLaunchProgress().percent, 0, 'launch reset clears the progress model')
    sut.setLaunchEnabled(false)
    assert.deepEqual(calls, [
        ['enabled', true],
        ['launching', true],
        ['enabled', true],
        ['details', 'Verifying'],
        ['progress', 0],
        ['progress', 37],
        ['progress', 100],
        ['failure', 'Failure', 'Description', 'landing.launch.okay'],
        ['overlayHandler'],
        ['overlay', true],
        ['launching', false],
        ['enabled', false]
    ])
    assert.deepEqual(taskbar, [0, 0.37, 1])
}

function testRetiredProgressMarkup(){
    const removedIds = [
        'upper',
        'lower',
        'image_seal_container',
        'updateAvailableTooltip',
        'launch_button',
        'launch_content',
        'launch_details',
        'launch_details_left',
        'launch_details_right',
        'launch_details_text',
        'launch_progress',
        'launch_progress_label'
    ]
    removedIds.forEach(id => {
        assert.doesNotMatch(landingMarkup, new RegExp(`id="${id}"`), `${id} stays retired from markup`)
        assert.doesNotMatch(landingSource, new RegExp(`['"]${id}['"]`), `${id} has no landing dependency`)
        assert.doesNotMatch(uiCoreSource, new RegExp(`['"]${id}['"]`), `${id} has no core layout dependency`)
        assert.doesNotMatch(launcherStyles, new RegExp(`#${id}\\b`), `${id} has no dead selector`)
    })
    assert.doesNotMatch(landingSource, /syncLegacyLaunchButton|legacy fallback/)
}

async function testServerStatusControllerWiring(){
    assert.match(landingSource, /require\('\.\/assets\/js\/serverstatuscontroller'\)/, 'Landing consumes the product status controller')
    assert.doesNotMatch(landingSource, /require\('\.\/assets\/js\/serverstatus'\)/, 'Landing does not bypass the controller')
    assert.doesNotMatch(landingSource, /document|getElementById|server_status_wrapper|landingPlayerLabel|player_count/, 'status polling has no retired DOM sink')
}

function createJavaScan({ discovered = null, downloadResult = Promise.resolve() } = {}){
    const calls = []
    const handlers = {}
    const config = {
        getDataDirectory: () => 'data',
        getSelectedServer: () => 'server',
        setJavaExecutable: (...args) => calls.push(['setJava', ...args]),
        save: () => calls.push(['save'])
    }
    const sut = loadFunctions(['asyncSystemScan'], {
        $: () => ({ fadeOut(_duration, done){ done() }, fadeIn(){ calls.push(['fadeIn']) } }),
        ConfigManager: config,
        Lang: language(),
        async discoverBestJvmInstallation(){ calls.push(['discover']); return discovered },
        javaExecFromRoot: root => `${root}/bin/java`,
        settingsJavaExecVal: { value: '' },
        async populateJavaExecDetails(value){ calls.push(['populate', value]) },
        async dlAsync(){ calls.push(['launch']) },
        setLaunchDetails: value => calls.push(['details', value]),
        toggleLaunchArea: value => calls.push(['launching', value]),
        setLaunchPercentage: value => calls.push(['progress', value]),
        setOverlayContent: (...args) => calls.push(['overlayContent', ...args]),
        setOverlayHandler: handler => { handlers.ack = handler },
        setDismissHandler: handler => { handlers.dismiss = handler },
        toggleOverlay: (...args) => calls.push(['overlay', ...args]),
        downloadJava(){ calls.push(['download']); return downloadResult },
        loggerLanding: { error: (...args) => calls.push(['error', ...args]) },
        showLaunchFailure: (...args) => calls.push(['failure', ...args])
    })
    return { calls, handlers, sut }
}

async function testJavaDiscoveryAndOverlayStateMachine(){
    const found = createJavaScan({ discovered: { path: 'jdk' } })
    await found.sut.asyncSystemScan({ supported: [21], suggestedMajor: 21 })
    assert.deepEqual(found.calls.filter(call => ['setJava', 'save', 'populate', 'launch'].includes(call[0])), [
        ['setJava', 'server', 'jdk/bin/java'],
        ['save'],
        ['populate', 'jdk/bin/java'],
        ['launch']
    ])

    const missing = createJavaScan()
    await missing.sut.asyncSystemScan({ supported: [21], suggestedMajor: 21 })
    assert.equal(typeof missing.handlers.ack, 'function')
    assert.equal(typeof missing.handlers.dismiss, 'function')
    missing.handlers.dismiss()
    assert.equal(typeof missing.handlers.ack, 'function', 'manual install replaces acknowledge action with cancel')
    const retry = missing.handlers.dismiss
    missing.handlers.ack()
    assert.deepEqual(missing.calls.slice(-2), [['launching', false], ['overlay', false]])
    retry()
    assert.equal(missing.calls.some(call => call[0] === 'overlay' && call[1] === false && call[2] === true), true)
    assert.equal(missing.calls.at(-1)[0], 'discover')
}

async function testJavaDownloadSuccessAndFailures(){
    const calls = []
    const intervals = new Set()
    const config = {
        getDataDirectory: () => 'data',
        getSelectedServer: () => 'server',
        setJavaExecutable: (...args) => calls.push(['setJava', ...args]),
        save: () => calls.push(['save'])
    }
    const sut = loadFunctions(['downloadJava'], {
        ConfigManager: config,
        Lang: language(),
        latestOpenJDK: async () => ({ id: 'jdk', url: 'fixture://jdk', path: 'jdk.zip', size: 10, algo: 'sha256', hash: 'hash' }),
        async downloadFile(_url, _path, progress){ progress({ transferred: 4 }); progress({ transferred: 10 }) },
        async validateLocalFile(){ return true },
        async extractJdk(){ calls.push(['extract']); return 'jdk/bin/java' },
        setDownloadPercentage: value => calls.push(['downloadProgress', value]),
        setLaunchDetails: value => calls.push(['details', value]),
        remote: { getCurrentWindow: () => ({ setProgressBar: value => calls.push(['taskbar', value]) }) },
        setInterval(listener){ intervals.add(listener); return listener },
        clearInterval(listener){ intervals.delete(listener) },
        asyncSystemScan: (...args) => calls.push(['rescan', ...args]),
        loggerLanding: { warn(){} },
        log: { error(){} }
    })
    await sut.downloadJava({ suggestedMajor: 21, distribution: 'temurin', supported: [21] })
    assert.deepEqual(calls.filter(call => call[0] === 'downloadProgress'), [
        ['downloadProgress', 40], ['downloadProgress', 100], ['downloadProgress', 100]
    ])
    assert.deepEqual(calls.filter(call => call[0] === 'taskbar'), [['taskbar', 2], ['taskbar', -1]])
    assert.equal(intervals.size, 0)
    assert.deepEqual(calls.filter(call => ['setJava', 'save', 'rescan'].includes(call[0])), [
        ['setJava', 'server', 'jdk/bin/java'], ['save'], ['rescan', { suggestedMajor: 21, distribution: 'temurin', supported: [21] }, true]
    ])

    const missingAsset = loadFunctions(['downloadJava'], {
        ConfigManager: config,
        Lang: language(),
        latestOpenJDK: async () => null
    })
    await assert.rejects(missingAsset.downloadJava({ suggestedMajor: 21 }), /landing.downloadJava.findJdkFailure/)

    const transferCalls = []
    const transferFailure = loadFunctions(['downloadJava'], {
        ConfigManager: config,
        Lang: language(),
        latestOpenJDK: async () => ({ url: 'fixture://jdk', path: 'jdk.zip', size: 1 }),
        async downloadFile(){ throw new Error('download failed') },
        setDownloadPercentage: value => transferCalls.push(['progress', value]),
        remote: { getCurrentWindow: () => ({ setProgressBar: value => transferCalls.push(['taskbar', value]) }) }
    })
    await assert.rejects(transferFailure.downloadJava({ suggestedMajor: 21 }), /download failed/)
    assert.deepEqual(transferCalls, [], 'transfer failure stops before install progress and extraction')

    const extractionCalls = []
    const extractionIntervals = new Set()
    const extractionFailure = loadFunctions(['downloadJava'], {
        ConfigManager: config,
        Lang: language(),
        latestOpenJDK: async () => ({ url: 'fixture://jdk', path: 'jdk.zip', size: 1 }),
        async downloadFile(_url, _path, progress){ progress({ transferred: 1 }) },
        setDownloadPercentage(){},
        remote: { getCurrentWindow: () => ({ setProgressBar: value => extractionCalls.push(value) }) },
        setLaunchDetails(){},
        setInterval(listener){ extractionIntervals.add(listener); return listener },
        clearInterval(listener){ extractionIntervals.delete(listener) },
        async extractJdk(){ throw new Error('extract failed') }
    })
    await assert.rejects(extractionFailure.downloadJava({ suggestedMajor: 21 }), /extract failed/)
    assert.deepEqual(extractionCalls, [2], 'extraction failure leaves the taskbar in indeterminate state')
    assert.equal(extractionIntervals.size, 1, 'extraction failure leaves the detail interval active')
}

async function testUnawaitedJavaRejection(){
    const expected = knownGap('java-download-unawaited')
    const rejection = new Error('async download failed')
    const scan = createJavaScan({ downloadResult: Promise.reject(rejection) })
    await scan.sut.asyncSystemScan({ supported: [21], suggestedMajor: 21 })
    const escaped = new Promise(resolve => process.once('unhandledRejection', resolve))
    const result = scan.handlers.ack()
    assert.equal(typeof result, expected.acknowledgeReturnType, 'overlay acknowledge does not return the download promise')
    const observedRejection = await escaped
    assert.equal(observedRejection, rejection, 'asynchronous download rejection escapes the local try/catch')
    assert.equal(observedRejection === rejection ? 'unhandled' : 'handled', expected.asyncRejection)
    assert.equal(scan.calls.some(call => call[0] === 'failure'), false)
}

function createRepairHarness({ invalidFiles = 0, verifyError = null, downloadError = null, process = null, authUser = { displayName: 'Player' } } = {}){
    const calls = []
    const repairProcess = new EventEmitter()
    class FullRepair {
        constructor(){ this.childProcess = repairProcess; this.destroyed = 0; FullRepair.instance = this }
        spawnReceiver(){ calls.push(['spawnReceiver']) }
        async verifyFiles(progress){ calls.push(['verify']); progress(25); if(verifyError) throw verifyError; return invalidFiles }
        async download(progress){ calls.push(['download']); progress(60); if(downloadError) throw downloadError }
        destroyReceiver(){ this.destroyed++; calls.push(['destroyReceiver']) }
    }
    class MojangIndexProcessor { async getVersionJson(){ return {} } }
    class DistributionIndexProcessor { async loadModLoaderVersionJson(){ return {} } }
    class ProcessBuilder {
        constructor(){ calls.push(['processBuilder']) }
        build(){ calls.push(['build']); return process }
    }
    const server = { rawServer: { id: 'server', minecraftVersion: '1.21', discord: null } }
    const distro = {
        rawDistribution: { discord: null },
        getServerById: () => server
    }
    const taskbar = []
    const lifecyclePrelude = landingSource.slice(
        landingSource.indexOf('// Keep reference to Minecraft Process'),
        landingSource.indexOf('async function dlAsync')
    )
    assert.match(lifecyclePrelude, /const GAME_JOINED_REGEX/)
    assert.match(lifecyclePrelude, /const GAME_LAUNCH_REGEX/)
    assert.match(lifecyclePrelude, /const MIN_LINGER/)
    const sut = loadFunctions(['toggleLaunchArea', 'setLaunchEnabled', 'showLaunchFailure', 'dlAsync'], {
        LoggerUtil: { getLogger: () => ({ info(){}, error(){} }) },
        loggerLanding: { error(){} },
        Lang: language(),
        DistroAPI: { refreshDistributionOrFallback: async () => distro, isDevMode: () => false },
        onDistroRefresh: () => calls.push(['refresh']),
        ConfigManager: {
            getSelectedServer: () => 'server', getSelectedAccount: () => authUser,
            getCommonDirectory: () => 'common', getInstanceDirectory: () => 'instance', getLauncherDirectory: () => 'launcher'
        },
        FullRepair,
        MojangIndexProcessor,
        DistributionIndexProcessor,
        ProcessBuilder,
        DiscordWrapper: { initRPC(){}, updateDetails(){}, shutdownRPC(){} },
        remote: { app: { getVersion: () => '1.0.9' }, getCurrentWindow: () => ({ setProgressBar: value => taskbar.push(value) }) },
        window: { squadArcade: {
            setEnabled: value => calls.push(['enabled', value]),
            setLaunching: value => calls.push(['launching', value])
        } },
        setLaunchDetails: value => calls.push(['details', value]),
        setLaunchPercentage: value => calls.push(['progress', value]),
        setDownloadPercentage: value => { calls.push(['downloadProgress', value]); taskbar.push(value / 100) },
        setOverlayContent: (...args) => calls.push(['failure', ...args]),
        setOverlayHandler: handler => calls.push(['overlayHandler', handler]),
        toggleOverlay: value => calls.push(['overlay', value]),
        setTimeout: listener => { calls.push(['timer', listener]); return listener },
        Date: { now: () => 10000 }
    }, `${launchStatePrelude()}\n${lifecyclePrelude}`)
    sut.setLaunchEnabled(true)
    return { calls, FullRepair, repairProcess, sut, taskbar }
}

async function testUnusableAccountStopsBeforeProcessBuilder(){
    const blocked = createRepairHarness({ authUser: null })
    await blocked.sut.dlAsync(true)
    assert.equal(blocked.calls.some(call => call[0] === 'spawnReceiver'), false)
    assert.equal(blocked.calls.some(call => call[0] === 'processBuilder'), false)
    assert.equal(blocked.calls.some(call => call[0] === 'build'), false)
}

async function testFullRepairContracts(){
    const expected = knownGap('full-repair-early-cleanup')
    const zero = createRepairHarness()
    await zero.sut.dlAsync(false)
    assert.equal(zero.calls.some(call => call[0] === 'download'), false)
    assert.equal(zero.FullRepair.instance.destroyed, 1)
    assert.equal(zero.taskbar.at(-1), -1)

    const many = createRepairHarness({ invalidFiles: 3 })
    await many.sut.dlAsync(false)
    assert.equal(many.calls.some(call => call[0] === 'download'), true)
    assert.equal(many.FullRepair.instance.destroyed, 1)
    assert.equal(many.taskbar.at(-1), -1)

    for(const fixture of [
        { name: 'verify failure', expected: expected.verifyFailure, options: { verifyError: { displayable: 'verify failed' } } },
        { name: 'download failure', expected: expected.downloadFailure, options: { invalidFiles: 2, downloadError: { displayable: 'download failed' } } }
    ]){
        const failed = createRepairHarness(fixture.options)
        await failed.sut.dlAsync(true)
        assert.equal(failed.calls.some(call => call[0] === 'failure'), true, fixture.name)
        assert.equal(failed.FullRepair.instance.destroyed, fixture.expected.destroyReceiverCalls, `${fixture.name} omits receiver cleanup`)
        assert.equal(failed.calls.filter(call => call[0] === 'build').length, fixture.expected.gameBuildCalls, `${fixture.name} never builds the game process`)
        assert.equal(failed.taskbar.at(-1) === -1, fixture.expected.taskbarReset, `${fixture.name} omits taskbar reset`)
    }
}

async function testProcessEmitterContracts(){
    const expected = knownGap('process-unrecognized-output')
    function gameProcess(){
        const proc = new EventEmitter()
        proc.stdout = new EventEmitter()
        proc.stderr = new EventEmitter()
        return proc
    }

    const recognizedProcess = gameProcess()
    const recognized = createRepairHarness({ process: recognizedProcess })
    await recognized.sut.dlAsync(true)
    recognizedProcess.stdout.emit('data', '[main/INFO]: ModLauncher 10.0 starting: java')
    const timer = recognized.calls.find(call => call[0] === 'timer')
    assert.ok(timer, 'recognized stdout schedules launch completion')
    timer[1]()
    assert.equal(recognized.calls.some(call => call[0] === 'launching' && call[1] === false), true)
    assert.equal(recognizedProcess.stdout.listenerCount('data'), 0)
    assert.equal(recognizedProcess.stderr.listenerCount('data'), 0)

    const unrecognizedProcess = gameProcess()
    const unrecognized = createRepairHarness({ process: unrecognizedProcess })
    await unrecognized.sut.dlAsync(true)
    unrecognizedProcess.stdout.emit('data', '[main/INFO]: A different startup line')
    assert.equal(unrecognized.calls.some(call => call[0] === 'launching' && call[1] === false), expected.unrecognizedStdoutClearsLaunch)
    unrecognizedProcess.stderr.emit('data', 'ordinary stderr')
    assert.equal(unrecognized.calls.some(call => call[0] === 'launching' && call[1] === false), expected.ordinaryStderrClearsLaunch)
    unrecognizedProcess.emit('close', 0, null)
    assert.equal(unrecognized.calls.some(call => call[0] === 'launching' && call[1] === false), expected.closeWithoutRpcClearsLaunch)
    assert.equal(unrecognizedProcess.stdout.listenerCount('data'), 1, 'unrecognized stdout keeps launch listener active')
    assert.equal(unrecognizedProcess.stderr.listenerCount('data'), 1, 'close does not remove stderr listener without Discord RPC')

    unrecognizedProcess.stderr.emit('data', 'No se pudo encontrar o cargar la clase principal net.minecraft.launchwrapper.Launch')
    assert.equal(unrecognized.calls.some(call => call[0] === 'failure'), true)
    assert.equal(unrecognized.calls.some(call => call[0] === 'launching' && call[1] === false), expected.launchWrapperErrorClearsLaunch, 'recognized LaunchWrapper failure clears launch state through showLaunchFailure')
}

async function testConfiguredJavaRouting(){
    const binding = landingSource.slice(landingSource.indexOf('// Expose the single launch entry'), landingSource.indexOf('// Bind selected account'))
    async function run(javaExecutable, validation){
        const calls = []
        const context = {
            window: {},
            loggerLanding: { info(){}, error: (...args) => calls.push(['error', ...args]) },
            DistroAPI: { getDistribution: async () => ({ getServerById: () => ({ effectiveJavaOptions: { supported: [21] } }) }) },
            ConfigManager: { getSelectedServer: () => 'server', getJavaExecutable: () => javaExecutable },
            ensureJavaDirIsRoot: value => value,
            validateSelectedJvm: async () => validation,
            asyncSystemScan: async () => calls.push(['scan']),
            dlAsync: async () => calls.push(['launch']),
            setLaunchDetails: value => calls.push(['details', value]),
            toggleLaunchArea: value => calls.push(['launching', value]),
            setLaunchPercentage: value => calls.push(['progress', value]),
            Lang: language(),
            showLaunchFailure: (...args) => calls.push(['failure', ...args])
        }
        vm.runInNewContext(binding, context)
        await context.window.launchGame()
        return { calls, entry: context.window.launchGame }
    }
    assert.equal((await run('java', { version: 21 })).calls.some(call => call[0] === 'launch'), true)
    assert.equal((await run('java', null)).calls.some(call => call[0] === 'scan'), true)
    assert.deepEqual((await run(null, null)).calls, [['scan']])
}

async function run(){
    assert.deepEqual(manifest.knownGaps.map(item => item.id), [
        'java-download-unawaited',
        'full-repair-early-cleanup',
        'process-unrecognized-output',
        'launch-double-click-window'
    ])
    await scenario('retired legacy progress nodes have no markup, script, layout, or style consumers', testRetiredProgressMarkup)
    await scenario('server polling uses the product controller without legacy mirrors', testServerStatusControllerWiring)
    await scenario('direct Home and taskbar progress stay in parity', testProgressParity)
    await scenario('configured Java routes valid, invalid, and missing executables', testConfiguredJavaRouting)
    await scenario('Java discovery, manual cancel, and retry preserve current state machine', testJavaDiscoveryAndOverlayStateMachine)
    await scenario('Java download success and failure states preserve current cleanup behavior', testJavaDownloadSuccessAndFailures)
    await scenario('Java overlay exposes an unawaited asynchronous rejection', testUnawaitedJavaRejection)
    await scenario('unusable accounts stop before repair and ProcessBuilder', testUnusableAccountStopsBeforeProcessBuilder)
    await scenario('FullRepair zero, invalid, verify, and download outcomes preserve cleanup behavior', testFullRepairContracts)
    await scenario('Minecraft process stdout, stderr, and close preserve launch-state behavior', testProcessEmitterContracts)
    console.log(`Legacy launch harness: ${scenarios} scenarios passed; ${manifest.knownGaps.length} known gaps characterized`)
}

run().catch(error => {
    console.error(error)
    process.exitCode = 1
})

const { createStatusClient } = require('./serverstatus')

function createEndpointKey(serverId, server){
    return server == null ? null : JSON.stringify([serverId, server.hostname, server.port])
}

exports.createServerStatusController = function({
    getSelectedServer,
    getDistribution,
    updateStatus,
    getOfflineText,
    logger,
    statusTransport
}){
    const { getStatus } = createStatusClient(statusTransport)
    const inFlight = new Map()

    const publishOfflineIfCurrent = selectedServerId => {
        if(getSelectedServer() === selectedServerId){
            updateStatus(false, getOfflineText())
        }
    }

    const refreshServerStatus = async () => {
        const selectedServerId = getSelectedServer()
        let serv
        try {
            const distribution = await getDistribution()
            serv = distribution?.getServerById?.(selectedServerId)
        } catch (err) {
            logger.warn('No se puede cargar la distribución para actualizar el estado del servidor, asumiendo que está desconectado.')
            logger.debug(err)
        }
        if(serv == null || typeof serv.hostname !== 'string' || serv.hostname.length === 0){
            publishOfflineIfCurrent(selectedServerId)
            return
        }
        const endpointKey = createEndpointKey(selectedServerId, serv)
        const pending = inFlight.get(endpointKey)
        if(pending != null){
            return await pending
        }
        const request = (async () => {
            logger.info('Refreshing Server Status')

            let pVal = getOfflineText()
            let online = false

            try {
                const servStat = await getStatus(serv.hostname, serv.port)
                pVal = servStat.onlinePlayers + '/' + servStat.maxPlayers
                online = true
            } catch (err) {
                logger.warn('No se puede actualizar el estado del servidor, asumiendo que está desconectado.')
                logger.debug(err)
            }
            let currentEndpointKey = null
            try {
                const distribution = await getDistribution()
                const currentServerId = getSelectedServer()
                currentEndpointKey = createEndpointKey(currentServerId, distribution.getServerById(currentServerId))
            } catch (err) {
                logger.debug(err)
            }
            if(currentEndpointKey === endpointKey){
                updateStatus(online, pVal)
            }
        })()
        inFlight.set(endpointKey, request)
        try {
            return await request
        } finally {
            if(inFlight.get(endpointKey) === request){
                inFlight.delete(endpointKey)
            }
        }
    }

    return {
        getInFlightCount: () => inFlight.size,
        refreshServerStatus
    }
}

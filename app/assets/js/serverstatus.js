const { resolveSrv } = require('dns/promises')
const net = require('net')

const STATUS_PROTOCOL_VERSION = 47
const HANDSHAKE_PACKET_ID = 0
const STATUS_REQUEST_PACKET_ID = 0
const STATUS_RESPONSE_PACKET_ID = 0
const STATUS_NEXT_STATE = 1
const STATUS_DEADLINE_MS = 5000
const MAX_STATUS_RESPONSE_BYTES = 1024 * 1024

function createStatusError(message, code){
    const error = new Error(message)
    error.code = code
    return error
}

function normalizePort(port){
    if(typeof port === 'string'){
        if(!/^\d+$/.test(port)){
            throw new RangeError(`Invalid Minecraft server port: ${port}`)
        }
        port = Number(port)
    }
    if(!Number.isSafeInteger(port) || port < 1 || port > 65535){
        throw new RangeError(`Invalid Minecraft server port: ${port}`)
    }
    return port
}

function encodeVarInt(value){
    const bytes = []
    let remaining = value >>> 0
    do {
        let current = remaining & 0x7F
        remaining >>>= 7
        if(remaining !== 0){
            current |= 0x80
        }
        bytes.push(current)
    } while(remaining !== 0)
    return Buffer.from(bytes)
}

function readVarInt(buffer, offset = 0){
    let value = 0
    for(let index = 0; index < 5; index++){
        if(offset + index >= buffer.length){
            return null
        }
        const current = buffer[offset + index]
        if(index === 4 && (current & 0xF0) !== 0){
            throw createStatusError('Invalid server status VarInt.', 'EPROTO')
        }
        value |= (current & 0x7F) << (7 * index)
        if((current & 0x80) === 0){
            return { value: value >>> 0, offset: offset + index + 1 }
        }
    }
    throw createStatusError('Invalid server status VarInt.', 'EPROTO')
}

function readFrameLength(chunks){
    let value = 0
    let index = 0
    for(const chunk of chunks){
        for(const current of chunk){
            if(index === 4 && (current & 0xF0) !== 0){
                throw createStatusError('Invalid server status frame length.', 'EPROTO')
            }
            value |= (current & 0x7F) << (7 * index)
            index++
            if((current & 0x80) === 0){
                return { value: value >>> 0, bytes: index }
            }
            if(index === 5){
                throw createStatusError('Invalid server status frame length.', 'EPROTO')
            }
        }
    }
    return null
}

function encodeString(value){
    const data = Buffer.from(value, 'utf8')
    return Buffer.concat([encodeVarInt(data.length), data])
}

function framePacket(payload){
    return Buffer.concat([encodeVarInt(payload.length), payload])
}

function buildHandshakePacket(hostname, port){
    const encodedPort = Buffer.allocUnsafe(2)
    encodedPort.writeUInt16BE(port)
    return framePacket(Buffer.concat([
        encodeVarInt(HANDSHAKE_PACKET_ID),
        encodeVarInt(STATUS_PROTOCOL_VERSION),
        encodeString(hostname),
        encodedPort,
        encodeVarInt(STATUS_NEXT_STATE)
    ]))
}

function buildStatusRequestPacket(){
    return framePacket(encodeVarInt(STATUS_REQUEST_PACKET_ID))
}

function parseStatusResponse(buffer){
    const frameLength = readVarInt(buffer)
    if(frameLength == null){
        throw createStatusError('Missing server status frame length.', 'EPROTO')
    }
    const frameEnd = frameLength.offset + frameLength.value
    if(frameEnd !== buffer.length){
        throw createStatusError('Inconsistent server status frame length.', 'EPROTO')
    }

    const frame = buffer.subarray(frameLength.offset, frameEnd)
    const packetId = readVarInt(frame)
    if(packetId == null || packetId.value !== STATUS_RESPONSE_PACKET_ID){
        throw createStatusError('Invalid server status response packet.', 'EPROTO')
    }
    const payloadLength = readVarInt(frame, packetId.offset)
    if(payloadLength == null){
        throw createStatusError('Missing server status payload length.', 'EPROTO')
    }
    const payloadEnd = payloadLength.offset + payloadLength.value
    if(payloadEnd !== frame.length){
        throw createStatusError('Inconsistent server status payload length.', 'EPROTO')
    }

    let status
    try {
        status = JSON.parse(frame.subarray(payloadLength.offset, payloadEnd).toString('utf8'))
    } catch(_error){
        throw createStatusError('Invalid server status JSON payload.', 'EPROTO')
    }
    const onlinePlayers = status?.players?.online
    const maxPlayers = status?.players?.max
    if(!Number.isInteger(onlinePlayers) || !Number.isInteger(maxPlayers) || onlinePlayers < 0 || maxPlayers < 0 || onlinePlayers > maxPlayers){
        throw createStatusError('Server status payload has invalid player counts.', 'EPROTO')
    }

    const description = status.description
    return {
        online: true,
        version: typeof status.version?.name === 'string' ? status.version.name : '',
        motd: typeof description === 'string' ? description : typeof description?.text === 'string' ? description.text : '',
        onlinePlayers: String(onlinePlayers),
        maxPlayers: String(maxPlayers)
    }
}

async function resolveTargets(address, port, lookupSrv){
    try {
        const records = await lookupSrv(`_minecraft._tcp.${address}`)
        const targets = records
            .filter(record => typeof record.name === 'string' && Number.isInteger(record.port) && record.port > 0 && record.port <= 65535)
            .sort((left, right) => left.priority - right.priority || right.weight - left.weight)
            .map(record => ({ address: record.name, port: record.port }))
        if(targets.length > 0){
            return targets
        }
    } catch(_error){
        // Fall back to the configured host and port when SRV lookup fails.
    }
    return [{ address, port }]
}

function destroySocket(socket){
    try {
        socket?.destroy()
    } catch(_error){
        // Socket cleanup is best effort and idempotent.
    }
}

function createStatusClient({
    resolveSrv: lookupSrv = resolveSrv,
    connect = net.connect,
    setTimeout: scheduleDeadline = setTimeout,
    clearTimeout: cancelDeadline = clearTimeout
} = {}){
    /**
     * Retrieve a Minecraft server's modern status response. The promise resolves
     * only for an online response and rejects for offline, timeout, or protocol
     * failures. DNS resolution, SRV failover, connection, and response share one
     * five-second deadline.
     *
     * @param {string} address The configured server address.
     * @param {number|string} port Optional server port. Defaults to 25565.
     * @returns {Promise.<Object>} The normalized online server status.
     */
    const getStatus = async function(address, port = 25565){
        port = normalizePort(port)

        return await new Promise((resolve, reject) => {
            let activeSocket = null
            let deadlineTimer = null
            let settled = false

            const settle = (error, status) => {
                if(settled){
                    return
                }
                settled = true
                cancelDeadline(deadlineTimer)
                destroySocket(activeSocket)
                activeSocket = null
                if(error == null){
                    resolve(status)
                } else {
                    reject(error)
                }
            }

            deadlineTimer = scheduleDeadline(() => {
                settle(createStatusError(`Server status deadline exceeded (${address}:${port}).`, 'ETIMEDOUT'))
            }, STATUS_DEADLINE_MS)

            const attemptTarget = (targets, index, previousError = null) => {
                if(settled){
                    return
                }
                if(index >= targets.length){
                    settle(previousError ?? createStatusError('No Minecraft status target was reachable.', 'ECONNREFUSED'))
                    return
                }

                const target = targets[index]
                const chunks = []
                let totalBytes = 0
                let expectedBytes = null
                let attemptSettled = false
                let socket

                const failAttempt = error => {
                    if(settled || attemptSettled){
                        return
                    }
                    attemptSettled = true
                    destroySocket(socket)
                    if(activeSocket === socket){
                        activeSocket = null
                    }
                    attemptTarget(targets, index + 1, error)
                }

                const completeAttempt = status => {
                    if(settled || attemptSettled){
                        return
                    }
                    attemptSettled = true
                    settle(null, status)
                }

                try {
                    socket = connect(target.port, target.address, () => {
                        if(settled || attemptSettled){
                            return
                        }
                        try {
                            socket.write(buildHandshakePacket(address, port))
                            socket.write(buildStatusRequestPacket())
                        } catch(error){
                            failAttempt(error)
                        }
                    })
                    activeSocket = socket
                    socket.on('data', data => {
                        if(settled || attemptSettled || data.length === 0){
                            return
                        }
                        if(totalBytes + data.length > MAX_STATUS_RESPONSE_BYTES){
                            failAttempt(createStatusError('Server status response exceeds 1 MiB.', 'EPROTO'))
                            return
                        }
                        chunks.push(data)
                        totalBytes += data.length
                        try {
                            if(expectedBytes == null){
                                const frameLength = readFrameLength(chunks)
                                if(frameLength == null){
                                    return
                                }
                                expectedBytes = frameLength.bytes + frameLength.value
                                if(expectedBytes > MAX_STATUS_RESPONSE_BYTES){
                                    throw createStatusError('Server status frame exceeds 1 MiB.', 'EPROTO')
                                }
                            }
                            if(totalBytes < expectedBytes){
                                return
                            }
                            if(totalBytes > expectedBytes){
                                throw createStatusError('Inconsistent server status response length.', 'EPROTO')
                            }
                            completeAttempt(parseStatusResponse(Buffer.concat(chunks, totalBytes)))
                        } catch(error){
                            failAttempt(error)
                        }
                    })
                    socket.once('error', failAttempt)
                    socket.once('end', () => failAttempt(createStatusError('Server ended the status connection without a complete response.', 'ECONNRESET')))
                    socket.once('close', () => failAttempt(createStatusError('Server closed the status connection without a complete response.', 'ECONNRESET')))
                } catch(error){
                    failAttempt(error)
                }
            }

            resolveTargets(address, port, lookupSrv).then(targets => {
                if(!settled){
                    attemptTarget(targets, 0)
                }
            }, settle)
        })
    }

    return { getStatus }
}

const defaultStatusClient = createStatusClient()

exports.createStatusClient = createStatusClient
exports.getStatus = defaultStatusClient.getStatus

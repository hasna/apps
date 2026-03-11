import { startServer } from './serve.js'

const port = Number(process.env['ECONOMY_PORT'] ?? 3456)
startServer(port)

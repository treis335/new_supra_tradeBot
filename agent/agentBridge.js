// agent/agentBridge.js
const fs = require('fs');
const path = require('path');

class AgentBridge {
    constructor() {
        this.commandsFile = path.join(__dirname, '../.agent_commands.json');
        this.responseFile = path.join(__dirname, '../.agent_responses.json');
        this.running = true;
    }

    // Enviar comando para o bot
    async sendCommand(command, params = {}) {
        const cmd = {
            id: Date.now().toString(),
            command: command,
            params: params,
            timestamp: new Date().toISOString()
        };

        // Escrever comando para o bot ler
        fs.writeFileSync(this.commandsFile, JSON.stringify(cmd, null, 2));
        
        // Aguardar resposta
        let attempts = 0;
        while (attempts < 20) {
            await this.sleep(500);
            if (fs.existsSync(this.responseFile)) {
                const response = JSON.parse(fs.readFileSync(this.responseFile, 'utf8'));
                if (response.id === cmd.id) {
                    fs.unlinkSync(this.responseFile);
                    return response;
                }
            }
            attempts++;
        }
        return { success: false, message: 'Timeout - Bot não respondeu' };
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Monitorar comandos do agente
    async listenForCommands(callback) {
        console.log('👂 Agente à escuta de comandos...');
        
        setInterval(() => {
            if (fs.existsSync(this.commandsFile)) {
                try {
                    const command = JSON.parse(fs.readFileSync(this.commandsFile, 'utf8'));
                    fs.unlinkSync(this.commandsFile);
                    
                    // Processar comando
                    callback(command);
                } catch (e) {
                    // Ignorar
                }
            }
        }, 1000);
    }
}

module.exports = AgentBridge;
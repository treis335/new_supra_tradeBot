// tui/systemLog.js
//
// ANTES: mensagens de sistema (analista, descoberta de pools, execuções) eram
// escritas diretamente no footerBox -- mas o renderFooter() corre no fim de
// CADA tick e reescreve o rodapé com o estado normal, apagando a mensagem
// antes do ecrã sequer a desenhar. Na prática, essas mensagens nunca eram
// vistas. Agora ficam aqui, e o renderlog.js mistura-as no feed do painel
// "LOG DE ARBS + ATIVIDADE" (que já é scrollável e persiste no tempo).

const systemLog = [];
const MAX_SYSTEM_LOG = 30;

function pushSystemLog(msg) {
    systemLog.unshift({ ts: Date.now(), text: msg });
    while (systemLog.length > MAX_SYSTEM_LOG) systemLog.pop();
}

function getSystemLog() {
    return systemLog;
}

module.exports = { pushSystemLog, getSystemLog };

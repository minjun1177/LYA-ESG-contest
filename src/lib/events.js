// Server-Sent Events 허브: 새 제보를 접속 중인 모든 사용자에게 실시간 전송

export class EventHub {
  constructor({ heartbeatMs = 25000 } = {}) {
    this.clients = new Set();
    // 프록시·터널이 유휴 연결을 끊지 않도록 주기적으로 주석 줄을 보냄
    this.timer = setInterval(() => this.#write(': ping\n\n'), heartbeatMs);
    this.timer.unref();
  }

  /** Express 핸들러: GET /api/events */
  handler = (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');
    this.clients.add(res);
    req.on('close', () => this.clients.delete(res));
  };

  broadcast(event, data) {
    this.#write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  #write(chunk) {
    for (const res of this.clients) {
      try {
        res.write(chunk);
      } catch {
        this.clients.delete(res);
      }
    }
  }

  close() {
    clearInterval(this.timer);
    for (const res of this.clients) res.end();
    this.clients.clear();
  }
}

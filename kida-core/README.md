```
888    d8P  8888888 8888888b.        d8888  v0.0.1
888   d8P     888   888  "Y88b      d88888  CORE
888  d8P      888   888    888     d88P888
888d88K       888   888    888    d88P 888
8888888b      888   888    888   d88P  888
888  Y88b     888   888    888  d88P   888
888   Y88b    888   888  .d88P d8888888888
888    Y88b 8888888 8888888P" d88P     888
```

> KIDA is the intelligent agent at the core of your server, quietly watching over the place, automating operations, and keeping everything under control.

# What is KIDA CORE

# Using KIDA CORE

KIDA tiene 2 formas de comunicación: HTTP y Unix socket. En ambos casos, el formato de entrada es JSON. Algunos ejemplos son:

```bash
curl -X POST http://127.0.0.1:8080/command -H 'Content-Type: application/json' -d '{"id": "1", "command": "system.health", "params": {}}'

echo '{"id": "1", "command": "system.health", "params": {}}' | socat - UNIX-CONNECT:/tmp/kida.sock
```

# License and trademarks

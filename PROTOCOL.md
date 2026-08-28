# Protocolo AirLink (v1)

Contrato entre la app web (móvil) y el receptor de AirTouch (PC).
**No cambiar sin cambiar los dos lados a la vez.**

## Transporte

- **Señalización**: WebSocket sobre TLS al PC.
  `wss://<ip-del-pc>:<puerto>/signal?role=phone&token=<código>`
- **Vídeo**: WebRTC directo móvil → PC por la red local.
  No se usan servidores STUN ni TURN: solo candidatos *host*, así que el
  tráfico nunca sale de tu WiFi.

## Emparejamiento

El PC genera un código aleatorio por sesión y lo muestra en un QR:

```
https://<ip>:<puerto>/?host=<ip>&port=<puerto>&token=<código>
```

El servidor rechaza cualquier WebSocket cuyo `token` no coincida. Sin esto,
cualquiera en la misma red podría conectarse a tu PC.

## Mensajes (JSON por WebSocket)

| Dirección | Mensaje | Contenido |
|---|---|---|
| móvil → PC | `hello` | `device`, `camera`, `requested: {res, fps}` |
| PC → móvil | `welcome` | `name` (nombre del PC) |
| móvil → PC | `offer` | `sdp` |
| PC → móvil | `answer` | `sdp` |
| ambos | `ice` | `candidate` (objeto RTCIceCandidateInit) |
| PC → móvil | `error` | `message` |
| ambos | `bye` | — |

Ejemplo:

```json
{"type":"offer","sdp":"v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\n..."}
{"type":"ice","candidate":{"candidate":"candidate:1 1 UDP ...","sdpMid":"0","sdpMLineIndex":0}}
```

## Vídeo

- Una sola pista de vídeo, sin audio.
- Códec: el que negocien (H.264 en iPhone, por hardware).
- El emisor pide `degradationPreference: maintain-resolution`: en una red local
  sobra ancho de banda y aquí la nitidez es justo lo que importa.
- `maxBitrate` 24 Mbps.

## Notas de plataforma

- `getUserMedia` exige contexto seguro: HTTPS, `localhost` o `127.0.0.1`.
- Una página servida por HTTPS **no puede** abrir `ws://` ni `http://` a una IP
  local: el navegador lo bloquea por contenido mixto. Por eso el PC sirve por
  **HTTPS** y la señalización va por **wss://**.
- iOS suspende la cámara al salir de la app. La página pide *Wake Lock* para
  que la pantalla no se apague.

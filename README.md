# AirLink

Convierte tu iPhone en una cámara de alta resolución y baja latencia para
[AirTouch](https://github.com/) — el sistema de control gestual para Windows.

Sin anuncios, sin cuentas, sin suscripción y sin servidores. **El vídeo va
directo del móvil al PC por tu WiFi**: no pasa por internet.

---

## Por qué existe

AirTouch controla el ordenador con las manos: el índice es el puntero, juntar
pulgar e índice es hacer clic, mantener el pinch y mover hace scroll. Todo eso
depende por completo de la calidad de la imagen — si la cámara va a 480p y
24 fps, los dedos se detectan con ruido y el puntero tiembla.

Las apps de «webcam por móvil» del mercado limitan la versión gratuita
justamente ahí: 480p, 24 fps y anuncios cada pocos segundos. AirLink hace lo
mismo a **1080p60**, gratis, y en unas 25 KB de código.

## Cómo funciona

1. El iPhone abre esta página web y pide la cámara con `getUserMedia`.
2. Abre un WebSocket seguro contra el PC. Ese canal se usa **solo** para el
   saludo: unos 3 KB de SDP y candidatos ICE.
3. Monta una `RTCPeerConnection` y le añade la pista de vídeo.
4. A partir de ahí el vídeo viaja **directo** móvil → PC por la red local,
   codificado por hardware y cifrado. No hay servidor intermedio.
5. En el PC, AirTouch decodifica los frames y se los pasa a su motor de visión.

No se usan servidores STUN ni TURN: solo candidatos *host*, así que el tráfico
nunca sale de tu red.

## Instalación en el iPhone

1. Abre la página en **Safari** (tiene que ser Safari; Chrome en iOS no permite
   instalar aplicaciones web).
2. Botón **Compartir** → **Añadir a pantalla de inicio**.
3. Ábrela desde el icono. Ya funciona como una app: pantalla completa, sin
   barra de direcciones y sin necesidad de datos.

## Emparejar con el PC

En AirTouch: **Cámara → Conectar teléfono**. Aparece un código QR. Escanéalo
con la cámara del iPhone y se abrirá AirLink con la dirección y el código ya
rellenados.

También puedes escribirlos a mano: dirección IP del PC, puerto (8443 por
defecto) y el código de emparejamiento que muestra AirTouch.

> El código no es decorativo: el PC rechaza cualquier conexión que no lo lleve.
> Sin él, cualquiera en tu misma red podría conectarse a tu ordenador.

## Colocación

Pon el móvil **encima del monitor, en horizontal, apuntándote a ti**.

Usa la **cámara trasera** (es la opción por defecto): tiene mucha más calidad
que la frontal y llega a 4K60. El móvil queda con la pantalla mirando a la
pared, que no molesta porque no necesitas verla.

## Calidad recomendada: 1080p60

Puede parecer que cuanta más resolución mejor, pero no:

AirTouch recorta la zona donde está tu mano y la analiza a 384×384 píxeles. A
1080p tu mano ya ocupa unos 400-600 píxeles en el encuadre, de sobra para el
modelo. Subir a 4K cuadruplica los datos y el coste de decodificación a cambio
de una mejora marginal.

**Lo que sí importa es el framerate.** A 24 fps se añaden ~42 ms de latencia y
el movimiento se ve a saltos. A 60 fps todo se siente inmediato.

| Ajuste | Cuándo |
|---|---|
| 1080p · 60 fps | **Recomendado.** El mejor equilibrio |
| 1440p · 60 fps | Si tu WiFi va sobrado (5 GHz, router cerca) |
| 720p · 60 fps | WiFi flojo, o un PC modesto |
| 4K | Solo si te colocas muy lejos de la cámara |

---

## La restricción de HTTPS (importante)

La cámara del navegador solo funciona en un **contexto seguro**: HTTPS,
`localhost` o `127.0.0.1`. Y a la vez, una página servida por HTTPS **no puede**
abrir `ws://` ni `http://` contra una IP de red local — el navegador lo bloquea
como *contenido mixto*.

Es decir: no vale servir la página por HTTP simple (no habría cámara), ni
servirla por HTTPS y hablar con el PC por HTTP (estaría bloqueado).

Por eso **AirTouch sirve esta misma página desde tu PC por HTTPS**, con un
certificado que genera él mismo, y la señalización va por `wss://`. Al ser el
mismo origen, no hay contenido mixto y todo funciona sin internet.

La copia publicada en GitHub Pages funciona igual, pero requiere que el
certificado del PC esté instalado como de confianza en el iPhone. Para el uso
normal, **abre la página desde el QR de AirTouch**: es el camino sin fricción.

## Si algo falla

**«Has denegado el acceso a la cámara»**
Ajustes → Safari → Cámara → Permitir. Si la abriste como app instalada:
Ajustes → AirLink → Cámara.

**«No se puede alcanzar el PC»**
Comprueba que el móvil y el PC están en la **misma red WiFi** (ojo con las
redes de invitados, que aíslan los dispositivos entre sí) y que AirTouch está
abierto con el motor en marcha. El cortafuegos de Windows debe permitir el
puerto 8443.

**Safari avisa de que la conexión no es privada**
Es el certificado que genera tu propio PC; no hay ninguna autoridad externa que
lo firme. Toca **Mostrar detalles → Visitar este sitio web**. Para quitarlo del
todo, instala el certificado desde AirTouch (Cámara → Instalar certificado).

**El vídeo se corta al salir de la app**
iOS suspende la cámara cuando la app pasa a segundo plano. Es una limitación
del sistema: deja AirLink en primer plano. La página pide *Wake Lock* para que
al menos la pantalla no se apague sola.

**Va a 30 fps y he pedido 60**
No todas las cámaras dan 60 fps en todas las resoluciones. Prueba a bajar de
1440p a 1080p.

---

## Privacidad

- El vídeo **nunca sale de tu red local**. Va directo del móvil al PC.
- El único tráfico de red es el saludo WebRTC, y también es contra tu PC.
- Sin telemetría, sin analítica, sin CDN, sin dependencias externas.
- El código son cuatro archivos que puedes leer en diez minutos.

## Estructura

```
index.html            emparejar + vista en directo
app.js                cámara, WebRTC, señalización, métricas, reconexión
style.css
manifest.webmanifest  para instalarla en la pantalla de inicio
sw.js                 caché de la carcasa: abre al instante y sin datos
PROTOCOL.md           el contrato con el receptor del PC
icons/
```

`PROTOCOL.md` define los mensajes de señalización. **Si lo cambias, hay que
cambiar también el receptor de AirTouch**: los dos lados tienen que coincidir.

## Licencia

MIT.

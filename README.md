# Trading-Bot-AI
BOT DE TRADING

## Pruebas del simulador 3.7.2

Requieren Node.js 22 o posterior; no necesitan paquetes, navegador ni conexión:

```sh
node --test --test-isolation=none tests/engine.test.cjs
```

Las pruebas ejecutan las funciones reales de `assets/trading_bot_ai_3_7_2.js` en un
contexto aislado, sin iniciar la interfaz, temporizadores ni consultas a Binance.
Utilizan precios sintéticos explícitos y resultados calculados de forma independiente.
Cubren SMA/EMA, RSI (promedio simple de los últimos 14 cambios, no suavizado de
Wilder), MACD, comisiones, deslizamiento, conciliación de efectivo, límites de
posiciones, cotizaciones vencidas, stop loss, take profit, bloqueo por pérdidas,
gaps y ejecución de señales con velas anteriores. Un caso modifica las velas
futuras y comprueba que no cambien operaciones ya cerradas.

Estas comprobaciones no prueban rentabilidad, integración con Binance ni todos
los escenarios posibles. La precedencia conservadora del stop cuando una vela
alcanza ambos límites es una convención del backtest; las velas OHLC no indican
qué precio se alcanzó primero. Las demás versiones HTML no están cubiertas.


## Desarrollo local

La versión 3.7.2 separa la interfaz HTML, los estilos en
`assets/trading_bot_ai_3_7_2.css` y el código en
`assets/trading_bot_ai_3_7_2.js`. Para copiar o publicar esta versión, conservá
el HTML y la carpeta `assets` juntos; el HTML solo ya no es autocontenido.
Las versiones anteriores siguen siendo archivos independientes.

Desde la raíz del repositorio:

```sh
python -m http.server 8000 --bind 127.0.0.1
```

Abrí la página `trading_bot_ai_3_7_2.html` del servidor en tu navegador.
Las cotizaciones y los estudios históricos necesitan acceso HTTPS a
`data-api.binance.vision`; las pruebas automatizadas funcionan sin conexión.

## Validación automática

El workflow `.github/workflows/tests.yml` ejecuta la comprobación de sintaxis y
la suite del simulador con Node.js 22 y 24 en cada push y pull request. También
puede iniciarse manualmente desde GitHub Actions. No necesita claves de API ni
acceso a Binance. Se activará cuando estos archivos se suban a GitHub; una
validación local no implica que el workflow remoto ya se haya ejecutado.

La suite incluye además posiciones con cotizaciones vencidas, liquidación de
emergencia con precios disponibles, reinicio de la racha de pérdidas tras una
ganancia y ejecución de take profit cuando el precio abre con un gap favorable.

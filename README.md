# RECARGAR-BS-SEAGM v1.0

Servidor de recargas automáticas para **Blood Strike** usando la plataforma **SEAGM**.

## 📦 Paquetes Disponibles

| Gold | Nombre | Precio USD | SKU |
|------|--------|------------|-----|
| 51 | 50 + 1 Golds | $0.31 | 23581 |
| 105 | 100 + 5 Golds | $0.61 | 24799 |
| 320 | 300 + 20 Golds | $1.84 | 24789 |
| 540 | 500 + 40 Golds | $3.02 | 24800 |
| 1100 | 1000 + 100 Golds | $6.05 | 24801 |
| 2260 | 2000 + 260 Golds | $12.10 | 24802 |
| 5800 | 5000 + 800 Golds | $30.67 | 24803 |

## 🚀 Instalación Local

```bash
# Instalar dependencias
npm install

# Modo TEST (no hace compras reales)
npm run dev

# Modo PRODUCCIÓN
npm run prod
```

## 🔧 Variables de Entorno

```env
PORT=3002
MODO_TEST=false
SEAGM_EMAIL=tu_email@gmail.com
SEAGM_PASSWORD=tu_password
RAILWAY_ENVIRONMENT=production
```

## 📡 API Endpoints

### GET /
Estado del servidor
```json
{
  "status": "ok",
  "servicio": "RECARGAR-BS-SEAGM",
  "sesion_activa": true,
  "modo_test": false
}
```

### GET /paquetes
Lista de paquetes disponibles

### GET /sesion
Verificar si hay sesión activa en SEAGM

### GET /balance
Obtener balance actual de SEAGM

### POST /login
Forzar login en SEAGM

### POST /test
Probar flujo SIN comprar
```json
{
  "id_juego": "825994928013",
  "gold": 105
}
```

### POST /recarga
Ejecutar recarga REAL
```json
{
  "id_juego": "825994928013",
  "gold": 105,
  "pedido_id": 123
}
```

**Respuesta exitosa:**
```json
{
  "success": true,
  "id_juego": "825994928013",
  "gold": 105,
  "paquete": "100 + 5 Golds",
  "precio_usd": 0.61,
  "order_id": "P80269648",
  "time_ms": 15000
}
```

## 🚂 Deploy en Railway

1. Crear nuevo proyecto en Railway
2. Conectar repositorio GitHub
3. Configurar variables de entorno:
   - `SEAGM_EMAIL`
   - `SEAGM_PASSWORD`
   - `MODO_TEST=false`
4. Deploy automático

## 📝 Flujo de Compra SEAGM

```
1. Login en SEAGM
2. Ir a página de Blood Strike
3. Seleccionar paquete (SKU)
4. Ingresar User ID
5. Click "Compra ahora"
6. Checkout - Click "Pagar Ahora"
7. Seleccionar SEAGM Balance
8. Click "Pay Now"
9. Confirmar contraseña
10. Verificar "Completado"
```

## ⚠️ Notas Importantes

- SEAGM **NO verifica nickname**, solo pide el User ID
- Se requiere saldo en SEAGM Balance
- La contraseña se pide 2 veces (login + confirmación de pago)
- Los screenshots de error se guardan en `./error_*.png`

## 🔄 Diferencias con HankGames

| Característica | HankGames | SEAGM |
|---------------|-----------|-------|
| Verifica Nickname | ✅ Sí | ❌ No |
| Proceso de checkout | Simple | Multi-página |
| Confirma contraseña | ❌ No | ✅ Sí |
| Balance | Hank Coins | SEAGM Balance |

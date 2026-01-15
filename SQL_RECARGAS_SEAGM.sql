-- =============================================
-- SQL para RECARGAR-BS-SEAGM
-- Tabla de historial de recargas via SEAGM
-- =============================================

-- Tabla para guardar historial de recargas SEAGM (Blood Strike y otros juegos)
CREATE TABLE IF NOT EXISTS recargas_seagm (
    id SERIAL PRIMARY KEY,
    juego VARCHAR(50) NOT NULL DEFAULT 'blood_strike',
    id_juego VARCHAR(100) NOT NULL,
    gold INTEGER NOT NULL,
    precio_usd DECIMAL(10,2),
    order_id VARCHAR(50),
    pedido_id INTEGER,
    tiempo_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_recargas_seagm_juego ON recargas_seagm(juego);
CREATE INDEX IF NOT EXISTS idx_recargas_seagm_id_juego ON recargas_seagm(id_juego);
CREATE INDEX IF NOT EXISTS idx_recargas_seagm_order_id ON recargas_seagm(order_id);
CREATE INDEX IF NOT EXISTS idx_recargas_seagm_created ON recargas_seagm(created_at DESC);

-- Si ya tienes pedidos_bs, agregar columna para order_id de SEAGM
ALTER TABLE pedidos_bs 
ADD COLUMN IF NOT EXISTS order_id_seagm VARCHAR(50);

-- Comentarios
COMMENT ON TABLE recargas_seagm IS 'Historial de recargas procesadas via SEAGM';
COMMENT ON COLUMN recargas_seagm.juego IS 'Juego: blood_strike, mobile_legends, etc';
COMMENT ON COLUMN recargas_seagm.id_juego IS 'ID del jugador en el juego';
COMMENT ON COLUMN recargas_seagm.gold IS 'Cantidad de gold/diamonds recargados';
COMMENT ON COLUMN recargas_seagm.precio_usd IS 'Precio pagado en USD';
COMMENT ON COLUMN recargas_seagm.order_id IS 'ID de orden de SEAGM (ej: P80269648)';
COMMENT ON COLUMN recargas_seagm.pedido_id IS 'ID del pedido en nuestra tabla pedidos_bs';
COMMENT ON COLUMN recargas_seagm.tiempo_ms IS 'Tiempo que tardó la recarga en ms';

-- =============================================
-- Config adicional para cambiar entre modos
-- =============================================

-- Agregar config para modo de recarga de BS
INSERT INTO config (clave, valor, descripcion) 
VALUES ('bs_plataforma_recarga', 'seagm', 'Plataforma de recarga para Blood Strike: seagm, hank')
ON CONFLICT (clave) DO UPDATE SET valor = 'seagm';

-- URL del servicio SEAGM en Railway
INSERT INTO config (clave, valor, descripcion) 
VALUES ('api_recarga_bs_seagm', 'https://recargar-bs-seagm-production.up.railway.app', 'URL del servicio de recargas BS via SEAGM')
ON CONFLICT (clave) DO NOTHING;

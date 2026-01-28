// server.js - RECARGAR-BS-SEAGM v1.0 - Blood Strike con SEAGM Balance
const puppeteer = require('puppeteer');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// ========== CONFIG ==========
const CONFIG = {
    PORT: process.env.PORT || 3002,
    TIMEOUT: 60000,
    MAX_REINTENTOS: 2,
    DELAY_RAPIDO: 300,
    DELAY_MEDIO: 800,
    DELAY_LARGO: 1500,
    MODO_TEST: process.env.MODO_TEST === 'true' ? true : false,
    URL_BLOOD_STRIKE: 'https://www.seagm.com/es/blood-strike-gold-top-up',
    URL_LOGIN: 'https://member.seagm.com/es/sso/login',
    URL_BASE: 'https://www.seagm.com',
    EMAIL: process.env.SEAGM_EMAIL || 'jose.emigdio@gmail.com',
    PASSWORD: process.env.SEAGM_PASSWORD || 'Amateratsu20',
    COOKIES_FILE: './cookies_seagm.json'
};

const SUPABASE_URL = 'https://jodltxvsernvdevqkswp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpvZGx0eHZzZXJudmRldnFrc3dwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYzNDA5MjAsImV4cCI6MjA4MTkxNjkyMH0.hG0VSDrdU2QAHVoUdJoDuCmCMyLb0lU5Oepfi7MJ_bA';

const PAQUETES_SEAGM = {
    51:   { sku: '23581', nombre: '50 + 1 Golds', precio: 0.31 },
    105:  { sku: '24799', nombre: '100 + 5 Golds', precio: 0.61 },
    320:  { sku: '24789', nombre: '300 + 20 Golds', precio: 1.84 },
    540:  { sku: '24800', nombre: '500 + 40 Golds', precio: 3.02 },
    1100: { sku: '24801', nombre: '1000 + 100 Golds', precio: 6.05 },
    2260: { sku: '24802', nombre: '2000 + 260 Golds', precio: 12.10 },
    5800: { sku: '24803', nombre: '5000 + 800 Golds', precio: 30.67 }
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let browser = null;
let page = null;
let sesionActiva = false;
let cola = [];
let procesando = false;

function log(emoji, mensaje, datos = null) {
    const tiempo = new Date().toLocaleTimeString('es-VE', { timeZone: 'America/Caracas' });
    const texto = `[${tiempo}] ${emoji} ${mensaje}`;
    if (datos) {
        console.log(texto, datos);
    } else {
        console.log(texto);
    }
}

async function supabaseQuery(table, query = '') {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    return res.json();
}

async function supabaseUpdate(table, data, query) {
    await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify(data)
    });
}

async function supabaseInsert(table, data) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'return=representation' },
        body: JSON.stringify(data)
    });
    return res.json();
}

async function guardarCookies() {
    if (!page) return;
    try {
        const cookies = await page.cookies();
        fs.writeFileSync(CONFIG.COOKIES_FILE, JSON.stringify(cookies, null, 2));
        log('💾', 'Cookies SEAGM guardadas');
    } catch (e) {
        log('⚠️', 'Error guardando cookies:', e.message);
    }
}

async function cargarCookies() {
    if (!page) return false;
    try {
        if (fs.existsSync(CONFIG.COOKIES_FILE)) {
            const cookies = JSON.parse(fs.readFileSync(CONFIG.COOKIES_FILE));
            await page.setCookie(...cookies);
            log('🍪', 'Cookies SEAGM cargadas');
            return true;
        }
    } catch (e) {
        log('⚠️', 'Error cargando cookies:', e.message);
    }
    return false;
}

async function cerrarPopups() {
    if (!page) return;
    try {
        const cerrado = await page.evaluate(() => {
            const allowAll = document.querySelector('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll, #CybotCookiebotDialogBodyButtonAccept');
            if (allowAll && allowAll.offsetParent !== null) {
                allowAll.click();
                return 'cookiebot-allow';
            }
            const cookiebotDialog = document.querySelector('#CybotCookiebotDialog');
            if (cookiebotDialog && cookiebotDialog.offsetParent !== null) {
                const allowBtn = cookiebotDialog.querySelector('button[id*="Allow"], button[id*="Accept"], .CybotCookiebotDialogBodyButton');
                if (allowBtn) {
                    allowBtn.click();
                    return 'cookiebot-dialog';
                }
            }
            const allButtons = Array.from(document.querySelectorAll('button'));
            for (const btn of allButtons) {
                if (btn.textContent.trim() === 'Allow all' && btn.offsetParent !== null) {
                    btn.click();
                    return 'allow-all-text';
                }
            }
            const acceptBtn = document.querySelector('[data-cky-tag="accept-button"], .cky-btn-accept');
            if (acceptBtn && acceptBtn.offsetParent !== null) {
                acceptBtn.click();
                return 'cookies-generic';
            }
            const acceptTexts = ['allow all', 'accept all', 'aceptar todo', 'accept'];
            for (const btn of allButtons) {
                const txt = btn.textContent.toLowerCase().trim();
                if (acceptTexts.some(t => txt === t) && btn.offsetParent !== null) {
                    btn.click();
                    return 'text-match';
                }
            }
            return null;
        });
        if (cerrado) {
            log('🍪', `Popup cerrado: ${cerrado}`);
            await sleep(300);
        }
    } catch (e) {}
}

async function verificarSesion() {
    if (!page) return false;
    try {
        await cerrarPopups();
        const logueado = await page.evaluate(() => {
            const signOutLink = document.querySelector('a[href*="/logout"], a[href*="/signout"]');
            if (signOutLink) return true;
            const miCuenta = Array.from(document.querySelectorAll('a')).find(a => 
                a.textContent.includes('Mi Cuenta') || a.textContent.includes('My Account')
            );
            if (miCuenta && miCuenta.offsetParent !== null) return true;
            const userDropdown = document.querySelector('.user-dropdown, .account-dropdown, [class*="user-name"]');
            if (userDropdown && userDropdown.textContent.trim().length > 0) return true;
            const userIcon = document.querySelector('.user-icon + span, .avatar + span');
            if (userIcon && userIcon.textContent.trim().length > 0) return true;
            const signInBtn = document.querySelector('a[href*="/sso/login"]:not([class*="hide"])');
            if (signInBtn) {
                const hasLogout = document.querySelector('a[href*="/logout"]');
                return !!hasLogout;
            }
            const bodyText = document.body.innerText;
            if (bodyText.includes('jose.emigdio') || bodyText.includes('JOSE')) return true;
            return false;
        });
        sesionActiva = logueado;
        log(logueado ? '✅' : '❌', `Verificación de sesión: ${logueado ? 'ACTIVA' : 'NO ACTIVA'}`);
        return logueado;
    } catch (e) {
        log('⚠️', 'Error verificando sesión:', e.message);
        return false;
    }
}

// ========== LOGIN CON FIX COOKIEBOT ==========
async function hacerLogin() {
    if (!page) return false;
    try {
        log('🔐', 'Iniciando login en SEAGM...');
        await page.goto(CONFIG.URL_LOGIN, { waitUntil: 'domcontentloaded', timeout: CONFIG.TIMEOUT });
        
        // ========== CERRAR COOKIEBOT PRIMERO ==========
        try {
            await page.waitForSelector('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', { timeout: 5000 });
            await page.click('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll');
            log('🍪', 'Cookiebot cerrado');
            await sleep(500);
        } catch (e) {
            await page.evaluate(() => {
                const btn = document.querySelector('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll');
                if (btn) btn.click();
            });
        }
        
        // Ya logueado?
        if (!page.url().includes('/sso/login')) {
            log('✅', 'Ya estaba logueado');
            sesionActiva = true;
            await guardarCookies();
            return true;
        }
        
        // ========== LLENAR FORMULARIO ==========
        log('📧', 'Llenando formulario...');
        await page.waitForSelector('#login_email', { timeout: 10000 });
        
        const loginResult = await page.evaluate((email, password) => {
            const emailRadio = document.querySelector('input[value="email"]');
            if (emailRadio) emailRadio.click();
            
            const emailInput = document.querySelector('#login_email');
            const passInput = document.querySelector('#login_pass');
            if (!emailInput || !passInput) return { error: 'Campos no encontrados' };
            
            emailInput.value = email;
            passInput.value = password;
            emailInput.dispatchEvent(new Event('input', { bubbles: true }));
            passInput.dispatchEvent(new Event('input', { bubbles: true }));
            
            const submitBtn = document.querySelector('#login_btw input[type="submit"]');
            if (submitBtn) { submitBtn.click(); return { success: true }; }
            return { error: 'No se pudo enviar' };
        }, CONFIG.EMAIL, CONFIG.PASSWORD);
        
        if (loginResult.error) {
            log('❌', loginResult.error);
            return false;
        }
        
        log('🚀', 'Login enviado');
        await sleep(4000);
        
        // Verificar error
        const error = await page.evaluate(() => {
            const alert = document.querySelector('#email_login_alert');
            return alert?.textContent?.trim() || null;
        });
        
        if (error) {
            log('❌', `Error: ${error}`);
            return false;
        }
        
        // Verificar éxito
        if (!page.url().includes('/sso/login')) {
            log('✅', 'Login exitoso!');
            sesionActiva = true;
            await guardarCookies();
            return true;
        }
        
        // Verificar en página de BS
        await page.goto(CONFIG.URL_BLOOD_STRIKE, { waitUntil: 'domcontentloaded', timeout: CONFIG.TIMEOUT });
        await sleep(1500);
        
        const logueado = await verificarSesion();
        if (logueado) {
            log('✅', 'Login verificado!');
            return true;
        }
        
        log('❌', 'Login falló');
        return false;
    } catch (e) {
        log('❌', `Error: ${e.message}`);
        return false;
    }
}

async function asegurarSesion() {
    const logueado = await verificarSesion();
    if (logueado) return true;
    log('⚠️', 'Sesión no detectada, intentando login...');
    return await hacerLogin();
}

async function initBrowser() {
    if (browser) return;
    
    log('🚀', 'Iniciando navegador...');
    const isRailway = !!process.env.RAILWAY_ENVIRONMENT;
    
    browser = await puppeteer.launch({
        headless: isRailway ? 'new' : false,
        executablePath: isRailway ? '/usr/bin/google-chrome-stable' : undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-animations', '--disable-extensions', '--window-size=1200,900']
    });
    
    page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 900 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    const cookiesCargadas = await cargarCookies();
    
    log('🌐', 'Cargando SEAGM Blood Strike...');
    await page.goto(CONFIG.URL_BLOOD_STRIKE, { waitUntil: 'networkidle2', timeout: CONFIG.TIMEOUT });
    await sleep(2000);
    await cerrarPopups();
    await sleep(500);
    await cerrarPopups();
    
    const logueado = await verificarSesion();
    
    if (logueado) {
        log('✅', 'Sesión SEAGM activa (cookies válidas)');
        await guardarCookies();
    } else {
        log('⚠️', 'Sesión no válida, intentando login automático...');
        const loginOk = await hacerLogin();
        if (loginOk) {
            log('✅', 'Login automático exitoso');
        } else {
            log('⚠️', '═'.repeat(45));
            log('⚠️', 'NO SE PUDO INICIAR SESIÓN');
            log('⚠️', 'Usa POST /cargar-cookies para subir cookies');
            log('⚠️', '═'.repeat(45));
        }
    }
    
    log('✅', 'Navegador listo');
}

async function ejecutarRecarga(idJugador, goldCantidad, hacerCompra = true) {
    const start = Date.now();
    
    try {
        log('🎮', '═'.repeat(50));
        log('🎮', hacerCompra ? 'INICIANDO RECARGA BLOOD STRIKE (SEAGM)' : 'TEST (SIN COMPRAR)');
        log('📋', `ID: ${idJugador} | Gold: ${goldCantidad}`);
        
        const paquete = PAQUETES_SEAGM[goldCantidad];
        if (!paquete) {
            return { success: false, error: `Paquete de ${goldCantidad} Gold no disponible en SEAGM` };
        }
        log('📦', `Paquete: ${paquete.nombre} - $${paquete.precio}`);
        
        const sesionOk = await asegurarSesion();
        if (!sesionOk) {
            return { success: false, error: 'No se pudo iniciar sesión en SEAGM' };
        }
        
        log('1️⃣', 'Cargando página de Blood Strike...');
        await page.goto(CONFIG.URL_BLOOD_STRIKE, { waitUntil: 'networkidle2', timeout: CONFIG.TIMEOUT });
        await sleep(1500);
        await cerrarPopups();
        await sleep(500);
        
        log('2️⃣', `Seleccionando paquete SKU: ${paquete.sku}...`);
        const paqueteSeleccionado = await page.evaluate((sku) => {
            const radio = document.querySelector(`input[name="topupType"][value="${sku}"]`);
            if (radio) { radio.click(); return true; }
            const skuDiv = document.querySelector(`.SKU_type[data-sku="${sku}"]`);
            if (skuDiv) { skuDiv.click(); return true; }
            return false;
        }, paquete.sku);
        
        if (!paqueteSeleccionado) {
            return { success: false, error: `No se pudo seleccionar el paquete ${paquete.nombre}` };
        }
        await sleep(CONFIG.DELAY_MEDIO);
        
        log('3️⃣', 'Ingresando ID de jugador...');
        const userIdInput = await page.$('input[name="userid"]');
        if (!userIdInput) {
            return { success: false, error: 'No se encontró el campo de User ID' };
        }
        await userIdInput.click({ clickCount: 3 });
        await userIdInput.type(idJugador, { delay: 30 });
        await sleep(CONFIG.DELAY_MEDIO);
        
        if (!hacerCompra || CONFIG.MODO_TEST) {
            const elapsed = Date.now() - start;
            log('🧪', `TEST COMPLETADO en ${elapsed}ms`);
            return {
                success: true,
                test_mode: true,
                id_juego: idJugador,
                gold: goldCantidad,
                paquete: paquete.nombre,
                precio_usd: paquete.precio,
                time_ms: elapsed,
                mensaje: 'Test exitoso - NO se realizó la compra'
            };
        }
        
        log('4️⃣', 'Haciendo click en Comprar ahora...');
        await page.evaluate(() => {
            const buyBtn = document.querySelector('#buyNowButton input[type="submit"], #ua-buyNowButton');
            if (buyBtn) buyBtn.click();
        });
        
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
        await sleep(2000);
        
        const currentUrl = page.url();
        if (!currentUrl.includes('order_checkout') && !currentUrl.includes('cart')) {
            log('⚠️', 'No se llegó al checkout, URL actual:', currentUrl);
            return { success: false, error: 'No se pudo llegar al checkout' };
        }
        
        log('✅', 'En página de checkout');
        await cerrarPopups();
        
        log('5️⃣', 'Haciendo click en Pagar Ahora...');
        await page.evaluate(() => {
            const payBtn = document.querySelector('.payNowButton');
            if (payBtn) payBtn.click();
        });
        
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
        await sleep(2000);
        
        const payUrl = page.url();
        if (!payUrl.includes('pay.seagm.com')) {
            log('⚠️', 'No se llegó a la página de pago, URL:', payUrl);
            return { success: false, error: 'No se pudo llegar a la página de pago' };
        }
        
        log('✅', 'En página de selección de pago');
        await cerrarPopups();
        await sleep(500);
        
        log('6️⃣', 'Seleccionando SEAGM Balance...');
        const balanceSeleccionado = await page.evaluate(() => {
            const allDivs = document.querySelectorAll('.channel, [class*="payment"]');
            for (const div of allDivs) {
                if (div.textContent.includes('SEAGM Balance')) {
                    div.click();
                    return true;
                }
            }
            const balanceImg = document.querySelector('img[alt="SEAGM Balance"]');
            if (balanceImg) {
                balanceImg.closest('.channel, label, div')?.click();
                return true;
            }
            return false;
        });
        
        if (!balanceSeleccionado) {
            log('⚠️', 'No se pudo seleccionar SEAGM Balance automáticamente');
        }
        await sleep(CONFIG.DELAY_MEDIO);
        
        log('7️⃣', 'Haciendo click en Pay Now...');
        await page.evaluate(() => {
            const payNowBtn = document.querySelector('.paynow input[type="submit"], label.paynow');
            if (payNowBtn) payNowBtn.click();
        });
        
        await sleep(2000);
        
        log('8️⃣', 'Ingresando contraseña de confirmación...');
        await page.waitForSelector('#password, input[name="password"]', { timeout: 10000 }).catch(() => {});
        
        const passwordInput = await page.$('#password');
        if (passwordInput) {
            await passwordInput.click({ clickCount: 3 });
            await passwordInput.type(CONFIG.PASSWORD, { delay: 30 });
            await sleep(CONFIG.DELAY_RAPIDO);
            
            log('9️⃣', 'Confirmando pago...');
            await page.evaluate(() => {
                const submitBtn = document.querySelector('#submit_button input[type="submit"], #submit_button');
                if (submitBtn) submitBtn.click();
            });
        } else {
            log('⚠️', 'No se encontró campo de contraseña');
        }
        
        log('🔟', 'Esperando confirmación...');
        await sleep(5000);
        
        let orderId = null;
        let completado = false;
        
        for (let i = 0; i < 15; i++) {
            const resultado = await page.evaluate(() => {
                const completadoEl = document.querySelector('.stat.completed, [class*="completed"]');
                if (completadoEl && completadoEl.textContent.includes('Completado')) {
                    const pidEl = document.querySelector('.pid');
                    const orderId = pidEl ? pidEl.textContent.trim() : null;
                    return { completado: true, orderId };
                }
                const errorEl = document.querySelector('.alert, .error, [class*="error"]');
                if (errorEl && errorEl.textContent.trim()) {
                    return { error: errorEl.textContent.trim() };
                }
                return null;
            });
            
            if (resultado) {
                if (resultado.error) {
                    return { success: false, error: resultado.error };
                }
                if (resultado.completado) {
                    completado = true;
                    orderId = resultado.orderId;
                    break;
                }
            }
            await sleep(1000);
        }
        
        if (!completado) {
            const finalUrl = page.url();
            log('⚠️', 'URL final:', finalUrl);
            const screenshotPath = `./debug_${Date.now()}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            log('📸', `Screenshot guardado: ${screenshotPath}`);
            return { success: false, error: 'No se pudo confirmar la compra' };
        }
        
        const elapsed = Date.now() - start;
        log('🎉', `RECARGA COMPLETADA en ${elapsed}ms`);
        log('🧾', `Order ID: ${orderId || 'N/A'}`);
        
        return {
            success: true,
            id_juego: idJugador,
            gold: goldCantidad,
            paquete: paquete.nombre,
            precio_usd: paquete.precio,
            order_id: orderId,
            time_ms: elapsed,
            mensaje: orderId ? `Compra exitosa - ${orderId}` : 'Compra procesada'
        };
        
    } catch (e) {
        log('❌', `Error: ${e.message}`);
        try {
            const screenshotPath = `./error_${Date.now()}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            log('📸', `Screenshot de error: ${screenshotPath}`);
        } catch (se) {}
        return { success: false, error: e.message };
    }
}

async function procesarCola() {
    if (procesando || cola.length === 0) return;
    procesando = true;
    
    while (cola.length > 0) {
        const item = cola.shift();
        const { datos, resolve } = item;
        
        log('⚡', `Procesando de cola (quedan ${cola.length})`);
        
        const resultado = await ejecutarRecarga(datos.id_juego, datos.gold, !CONFIG.MODO_TEST);
        
        if (resultado.success && !resultado.test_mode) {
            try {
                if (datos.pedido_id) {
                    await supabaseUpdate('pedidos_bs', 
                        { estado: 'entregado', order_id_seagm: resultado.order_id || null, entregado_at: new Date().toISOString() }, 
                        `?id=eq.${datos.pedido_id}`
                    );
                }
                await supabaseInsert('recargas_seagm', {
                    juego: 'blood_strike',
                    id_juego: datos.id_juego,
                    gold: datos.gold,
                    precio_usd: resultado.precio_usd,
                    order_id: resultado.order_id || null,
                    pedido_id: datos.pedido_id || null,
                    tiempo_ms: resultado.time_ms,
                    created_at: new Date().toISOString()
                });
                log('💾', `Registro guardado - OrderId: ${resultado.order_id || 'N/A'}`);
            } catch (e) {
                log('⚠️', 'Error guardando en Supabase:', e.message);
            }
        }
        
        resolve(resultado);
        if (cola.length > 0) await sleep(3000);
    }
    procesando = false;
}

function agregarACola(datos) {
    return new Promise((resolve) => {
        cola.push({ datos, resolve });
        log('📋', `Agregado a cola (posición ${cola.length})`);
        procesarCola();
    });
}

// ========== ENDPOINTS ==========
app.get('/', (req, res) => {
    res.json({ 
        status: 'ok',
        servicio: 'RECARGAR-BS-SEAGM',
        version: '1.0.1',
        plataforma: 'SEAGM',
        sesion_activa: sesionActiva,
        en_cola: cola.length,
        procesando,
        modo_test: CONFIG.MODO_TEST
    });
});

app.get('/ping', (req, res) => {
    res.json({ pong: true, timestamp: Date.now() });
});

app.get('/sesion', async (req, res) => {
    const activa = await verificarSesion();
    res.json({ sesion_activa: activa, mensaje: activa ? 'Sesión SEAGM activa' : 'Necesitas iniciar sesión' });
});

app.post('/guardar-sesion', async (req, res) => {
    try {
        await guardarCookies();
        sesionActiva = true;
        res.json({ success: true, mensaje: 'Sesión SEAGM guardada' });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

app.post('/cargar-cookies', async (req, res) => {
    try {
        const { cookies } = req.body;
        if (!cookies || !Array.isArray(cookies)) {
            return res.json({ success: false, error: 'Envía { "cookies": [...] }' });
        }
        if (!page) {
            return res.json({ success: false, error: 'Navegador no inicializado' });
        }
        
        await page.setCookie(...cookies);
        log('🍪', `${cookies.length} cookies cargadas via POST`);
        fs.writeFileSync(CONFIG.COOKIES_FILE, JSON.stringify(cookies, null, 2));
        log('💾', 'Cookies guardadas en archivo');
        
        await page.goto(CONFIG.URL_BLOOD_STRIKE, { waitUntil: 'networkidle2', timeout: CONFIG.TIMEOUT });
        await sleep(2000);
        await cerrarPopups();
        
        const logueado = await verificarSesion();
        res.json({ success: logueado, mensaje: logueado ? 'Cookies cargadas y sesión activa' : 'Cookies cargadas pero sesión no válida', sesion_activa: logueado });
    } catch (e) {
        log('❌', 'Error cargando cookies:', e.message);
        res.json({ success: false, error: e.message });
    }
});

app.post('/login', async (req, res) => {
    log('🔐', 'Login SEAGM solicitado');
    try {
        const exito = await hacerLogin();
        res.json({ success: exito, mensaje: exito ? 'Login exitoso' : 'Login falló' });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

app.post('/test', async (req, res) => {
    const { id_juego, gold } = req.body;
    if (!id_juego || !gold) {
        return res.json({ success: false, error: 'Faltan datos (id_juego, gold)' });
    }
    log('🧪', 'TEST SOLICITADO');
    const resultado = await ejecutarRecarga(id_juego, parseInt(gold), false);
    res.json({ ...resultado, test_mode: true });
});

app.post('/recarga', async (req, res) => {
    const { id_juego, gold, pedido_id } = req.body;
    if (!id_juego || !gold) {
        return res.json({ success: false, error: 'Faltan datos (id_juego, gold)' });
    }
    log('🎯', `RECARGA SOLICITADA: ID=${id_juego} Gold=${gold}`);
    const resultado = await agregarACola({ id_juego, gold: parseInt(gold), pedido_id });
    res.json(resultado);
});

app.get('/paquetes', (req, res) => {
    const paquetes = Object.entries(PAQUETES_SEAGM).map(([gold, info]) => ({
        gold: parseInt(gold), nombre: info.nombre, precio_usd: info.precio, sku: info.sku
    }));
    res.json({ success: true, plataforma: 'SEAGM', paquetes });
});

app.get('/balance', async (req, res) => {
    try {
        if (!page) {
            return res.json({ success: false, error: 'Navegador no inicializado' });
        }
        const balance = await page.evaluate(() => {
            const balanceEl = document.querySelector('[class*="balance"] b, .tips b');
            if (balanceEl) return balanceEl.textContent.trim();
            return null;
        });
        res.json({ success: !!balance, balance: balance || 'No disponible', sesion_activa: sesionActiva });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

async function start() {
    console.log('\n');
    log('⚔️', '═'.repeat(50));
    log('⚔️', 'RECARGAR-BS-SEAGM v1.0.1 - Blood Strike / SEAGM');
    log('⚔️', '═'.repeat(50));
    log('📍', `Entorno: ${process.env.RAILWAY_ENVIRONMENT ? 'Railway' : 'Local'}`);
    log('📍', `Puerto: ${CONFIG.PORT}`);
    
    if (CONFIG.MODO_TEST) {
        log('🧪', '⚠️  MODO TEST - NO compras reales');
    } else {
        log('🚨', '💰 MODO PRODUCCIÓN - Compras REALES');
    }
    
    await initBrowser();
    
    app.listen(CONFIG.PORT, '0.0.0.0', () => {
        log('⚡', `Servidor listo en puerto ${CONFIG.PORT}`);
        log('📋', 'Endpoints: GET /, /ping, /sesion, /paquetes, /balance | POST /login, /guardar-sesion, /cargar-cookies, /test, /recarga');
    });
}

process.on('SIGINT', async () => { 
    if (page) await guardarCookies();
    if (browser) await browser.close(); 
    process.exit(); 
});
process.on('SIGTERM', async () => { 
    if (page) await guardarCookies();
    if (browser) await browser.close(); 
    process.exit(); 
});

start();

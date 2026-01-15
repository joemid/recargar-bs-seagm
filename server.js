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
    // MODO TEST: false = producción (compras reales), true = solo pruebas
    MODO_TEST: process.env.MODO_TEST === 'true' ? true : false,
    // URLs de SEAGM
    URL_BLOOD_STRIKE: 'https://www.seagm.com/es/blood-strike-gold-top-up',
    URL_LOGIN: 'https://member.seagm.com/es/sso/login',
    URL_BASE: 'https://www.seagm.com',
    // Credenciales (usar variables de entorno en producción)
    EMAIL: process.env.SEAGM_EMAIL || 'jose.emigdio@gmail.com',
    PASSWORD: process.env.SEAGM_PASSWORD || 'Amateratsu20',
    // Archivo para guardar cookies de sesión
    COOKIES_FILE: './cookies_seagm.json'
};

const SUPABASE_URL = 'https://jodltxvsernvdevqkswp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpvZGx0eHZzZXJudmRldnFrc3dwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYzNDA5MjAsImV4cCI6MjA4MTkxNjkyMH0.hG0VSDrdU2QAHVoUdJoDuCmCMyLb0lU5Oepfi7MJ_bA';

// Mapeo de Gold a SKU de SEAGM
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

// ========== LOGS ==========
function log(emoji, mensaje, datos = null) {
    const tiempo = new Date().toLocaleTimeString('es-VE', { timeZone: 'America/Caracas' });
    const texto = `[${tiempo}] ${emoji} ${mensaje}`;
    if (datos) {
        console.log(texto, datos);
    } else {
        console.log(texto);
    }
}

// ========== SUPABASE ==========
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

// ========== COOKIES / SESIÓN ==========
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

// Cerrar popups de cookies o modales (funciona en www.seagm.com y pay.seagm.com)
async function cerrarPopups() {
    if (!page) return;
    try {
        const cerrado = await page.evaluate(() => {
            // 1. Cookiebot - Botón verde "Allow all" (aparece en pay.seagm.com)
            const allowAll = document.querySelector('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll, #CybotCookiebotDialogBodyButtonAccept');
            if (allowAll && allowAll.offsetParent !== null) {
                allowAll.click();
                return 'cookiebot-allow';
            }
            
            // 2. Cualquier botón dentro del dialog de Cookiebot
            const cookiebotDialog = document.querySelector('#CybotCookiebotDialog');
            if (cookiebotDialog && cookiebotDialog.offsetParent !== null) {
                const allowBtn = cookiebotDialog.querySelector('button[id*="Allow"], button[id*="Accept"], .CybotCookiebotDialogBodyButton');
                if (allowBtn) {
                    allowBtn.click();
                    return 'cookiebot-dialog';
                }
            }
            
            // 3. Buscar por texto exacto "Allow all" en cualquier botón
            const allButtons = Array.from(document.querySelectorAll('button'));
            for (const btn of allButtons) {
                if (btn.textContent.trim() === 'Allow all' && btn.offsetParent !== null) {
                    btn.click();
                    return 'allow-all-text';
                }
            }
            
            // 4. Botón genérico de aceptar cookies
            const acceptBtn = document.querySelector('[data-cky-tag="accept-button"], .cky-btn-accept');
            if (acceptBtn && acceptBtn.offsetParent !== null) {
                acceptBtn.click();
                return 'cookies-generic';
            }
            
            // 5. Buscar botones con texto de aceptar
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
    } catch (e) {
        // Ignorar errores
    }
}

// Verificar si hay sesión activa en SEAGM
async function verificarSesion() {
    if (!page) return false;
    
    try {
        // Cerrar popups primero
        await cerrarPopups();
        
        // Buscar indicadores de sesión activa en SEAGM
        const logueado = await page.evaluate(() => {
            // 1. Buscar enlace de "Sign Out" o "Cerrar sesión" (indica que SÍ está logueado)
            const signOutLink = document.querySelector('a[href*="/logout"], a[href*="/signout"]');
            if (signOutLink) return true;
            
            // 2. Buscar "Mi Cuenta" visible
            const miCuenta = Array.from(document.querySelectorAll('a')).find(a => 
                a.textContent.includes('Mi Cuenta') || 
                a.textContent.includes('My Account')
            );
            if (miCuenta && miCuenta.offsetParent !== null) return true;
            
            // 3. Buscar nombre de usuario en header (usualmente un dropdown)
            const userDropdown = document.querySelector('.user-dropdown, .account-dropdown, [class*="user-name"]');
            if (userDropdown && userDropdown.textContent.trim().length > 0) return true;
            
            // 4. Buscar icono de usuario con nombre
            const userIcon = document.querySelector('.user-icon + span, .avatar + span');
            if (userIcon && userIcon.textContent.trim().length > 0) return true;
            
            // 5. Verificar que NO hay botón de "Sign In" visible prominente
            const signInBtn = document.querySelector('a[href*="/sso/login"]:not([class*="hide"])');
            if (signInBtn) {
                // Hay botón de login visible, verificar si también hay logout
                const hasLogout = document.querySelector('a[href*="/logout"]');
                return !!hasLogout;
            }
            
            // 6. Buscar cualquier elemento que muestre email o username
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

// Login automático en SEAGM
async function hacerLogin() {
    if (!page) return false;
    
    try {
        log('🔐', 'Iniciando login en SEAGM...');
        
        // Ir a página de login
        await page.goto(CONFIG.URL_LOGIN, { waitUntil: 'networkidle2', timeout: CONFIG.TIMEOUT });
        await sleep(2000);
        
        await cerrarPopups();
        
        // Verificar si ya está logueado (redirigió)
        const currentUrl = page.url();
        if (!currentUrl.includes('/sso/login')) {
            log('✅', 'Ya estaba logueado (redirigido)');
            sesionActiva = true;
            await guardarCookies();
            return true;
        }
        
        // Asegurarse de que está en tab de "Cuenta de usuario" (email)
        const emailTab = await page.$('input[type="radio"][value="email"]');
        if (emailTab) {
            await emailTab.click();
            await sleep(300);
        }
        
        // Llenar email
        log('📧', 'Ingresando email...');
        await page.waitForSelector('#login_email', { timeout: 10000 });
        await page.click('#login_email', { clickCount: 3 }); // Seleccionar todo
        await page.type('#login_email', CONFIG.EMAIL, { delay: 30 });
        await sleep(CONFIG.DELAY_RAPIDO);
        
        // Llenar password
        log('🔑', 'Ingresando contraseña...');
        await page.click('#login_pass', { clickCount: 3 });
        await page.type('#login_pass', CONFIG.PASSWORD, { delay: 30 });
        await sleep(CONFIG.DELAY_RAPIDO);
        
        // Click en "Iniciar sesión"
        log('🚀', 'Enviando login...');
        await page.evaluate(() => {
            const submitBtn = document.querySelector('#login_btw input[type="submit"]');
            if (submitBtn) submitBtn.click();
        });
        
        // Esperar redirección o respuesta
        await sleep(5000);
        
        // Verificar si hay error
        const hayError = await page.evaluate(() => {
            const alertEl = document.querySelector('#email_login_alert');
            if (alertEl && alertEl.textContent.trim()) return alertEl.textContent.trim();
            return null;
        });
        
        if (hayError) {
            log('❌', `Error de login: ${hayError}`);
            return false;
        }
        
        // Verificar login exitoso
        const newUrl = page.url();
        if (!newUrl.includes('/sso/login')) {
            log('✅', 'Login exitoso!');
            sesionActiva = true;
            await guardarCookies();
            return true;
        }
        
        // Intentar verificar de otra forma
        await page.goto(CONFIG.URL_BLOOD_STRIKE, { waitUntil: 'networkidle2', timeout: CONFIG.TIMEOUT });
        await sleep(2000);
        
        const logueado = await verificarSesion();
        if (logueado) {
            log('✅', 'Login verificado!');
            return true;
        }
        
        log('❌', 'Login falló');
        return false;
        
    } catch (e) {
        log('❌', `Error en login: ${e.message}`);
        return false;
    }
}

// Asegurar sesión
async function asegurarSesion() {
    const logueado = await verificarSesion();
    if (logueado) return true;
    
    log('⚠️', 'Sesión no detectada, intentando login...');
    return await hacerLogin();
}

// ========== INICIAR NAVEGADOR ==========
async function initBrowser() {
    if (browser) return;
    
    log('🚀', 'Iniciando navegador...');
    const isRailway = !!process.env.RAILWAY_ENVIRONMENT;
    
    browser = await puppeteer.launch({
        headless: isRailway ? 'new' : false,
        executablePath: isRailway ? '/usr/bin/google-chrome-stable' : undefined,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage',
            '--disable-animations',
            '--disable-extensions',
            '--window-size=1200,900'
        ]
    });
    
    page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 900 });
    
    // User agent más realista
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // 1. Cargar cookies ANTES de navegar
    const cookiesCargadas = await cargarCookies();
    
    // 2. Ir directo a la página de Blood Strike
    log('🌐', 'Cargando SEAGM Blood Strike...');
    await page.goto(CONFIG.URL_BLOOD_STRIKE, { waitUntil: 'networkidle2', timeout: CONFIG.TIMEOUT });
    await sleep(2000);
    
    // 3. Cerrar popup de cookies si aparece
    await cerrarPopups();
    await sleep(500);
    await cerrarPopups(); // Doble intento por si tarda en cargar
    
    // 4. Verificar si la sesión es válida
    const logueado = await verificarSesion();
    
    if (logueado) {
        log('✅', 'Sesión SEAGM activa (cookies válidas)');
        await guardarCookies(); // Actualizar cookies
    } else {
        log('⚠️', 'Sesión no válida, intentando login automático...');
        
        // Intentar login automático
        const loginOk = await hacerLogin();
        
        if (loginOk) {
            log('✅', 'Login automático exitoso');
        } else {
            log('⚠️', '═'.repeat(45));
            log('⚠️', 'NO SE PUDO INICIAR SESIÓN');
            log('⚠️', 'Opciones:');
            log('⚠️', '1. Inicia sesión manualmente en el navegador');
            log('⚠️', '2. Llama a POST /guardar-sesion');
            log('⚠️', '3. O usa POST /login para reintentar');
            log('⚠️', '═'.repeat(45));
        }
    }
    
    log('✅', 'Navegador listo');
}

// ========== RECARGA BLOOD STRIKE SEAGM ==========
async function ejecutarRecarga(idJugador, goldCantidad, hacerCompra = true) {
    const start = Date.now();
    
    try {
        log('🎮', '═'.repeat(50));
        log('🎮', hacerCompra ? 'INICIANDO RECARGA BLOOD STRIKE (SEAGM)' : 'TEST (SIN COMPRAR)');
        log('📋', `ID: ${idJugador} | Gold: ${goldCantidad}`);
        
        // Verificar paquete válido
        const paquete = PAQUETES_SEAGM[goldCantidad];
        if (!paquete) {
            return { success: false, error: `Paquete de ${goldCantidad} Gold no disponible en SEAGM` };
        }
        log('📦', `Paquete: ${paquete.nombre} - $${paquete.precio}`);
        
        // Asegurar sesión
        const sesionOk = await asegurarSesion();
        if (!sesionOk) {
            return { success: false, error: 'No se pudo iniciar sesión en SEAGM' };
        }
        
        // ========== PASO 1: Ir a página de Blood Strike ==========
        log('1️⃣', 'Cargando página de Blood Strike...');
        await page.goto(CONFIG.URL_BLOOD_STRIKE, { waitUntil: 'networkidle2', timeout: CONFIG.TIMEOUT });
        await sleep(1500);
        await cerrarPopups();
        await sleep(500);
        
        // ========== PASO 2: Seleccionar paquete ==========
        log('2️⃣', `Seleccionando paquete SKU: ${paquete.sku}...`);
        
        const paqueteSeleccionado = await page.evaluate((sku) => {
            // Buscar el radio button con el SKU correcto
            const radio = document.querySelector(`input[name="topupType"][value="${sku}"]`);
            if (radio) {
                radio.click();
                return true;
            }
            
            // Alternativa: buscar por data-sku
            const skuDiv = document.querySelector(`.SKU_type[data-sku="${sku}"]`);
            if (skuDiv) {
                skuDiv.click();
                return true;
            }
            
            return false;
        }, paquete.sku);
        
        if (!paqueteSeleccionado) {
            return { success: false, error: `No se pudo seleccionar el paquete ${paquete.nombre}` };
        }
        await sleep(CONFIG.DELAY_MEDIO);
        
        // ========== PASO 3: Ingresar User ID ==========
        log('3️⃣', 'Ingresando ID de jugador...');
        
        // Buscar el input de userid
        const userIdInput = await page.$('input[name="userid"]');
        if (!userIdInput) {
            return { success: false, error: 'No se encontró el campo de User ID' };
        }
        
        await userIdInput.click({ clickCount: 3 });
        await userIdInput.type(idJugador, { delay: 30 });
        await sleep(CONFIG.DELAY_MEDIO);
        
        // Si es modo test, parar aquí
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
        
        // ========== PASO 4: Click en "Compra ahora" ==========
        log('4️⃣', 'Haciendo click en Comprar ahora...');
        
        await page.evaluate(() => {
            const buyBtn = document.querySelector('#buyNowButton input[type="submit"], #ua-buyNowButton');
            if (buyBtn) buyBtn.click();
        });
        
        // Esperar navegación al checkout
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
        await sleep(2000);
        
        // Verificar que estamos en checkout
        const currentUrl = page.url();
        if (!currentUrl.includes('order_checkout') && !currentUrl.includes('cart')) {
            log('⚠️', 'No se llegó al checkout, URL actual:', currentUrl);
            return { success: false, error: 'No se pudo llegar al checkout' };
        }
        
        log('✅', 'En página de checkout');
        await cerrarPopups();
        
        // ========== PASO 5: Click en "Pagar Ahora" (checkout) ==========
        log('5️⃣', 'Haciendo click en Pagar Ahora...');
        
        await page.evaluate(() => {
            const payBtn = document.querySelector('.payNowButton');
            if (payBtn) payBtn.click();
        });
        
        // Esperar navegación a selección de pago
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
        await sleep(2000);
        
        // Verificar que estamos en página de pago
        const payUrl = page.url();
        if (!payUrl.includes('pay.seagm.com')) {
            log('⚠️', 'No se llegó a la página de pago, URL:', payUrl);
            return { success: false, error: 'No se pudo llegar a la página de pago' };
        }
        
        log('✅', 'En página de selección de pago');
        await cerrarPopups();
        await sleep(500);
        
        // ========== PASO 6: Seleccionar SEAGM Balance ==========
        log('6️⃣', 'Seleccionando SEAGM Balance...');
        
        // Buscar y hacer click en SEAGM Balance
        const balanceSeleccionado = await page.evaluate(() => {
            // Buscar el div que contiene "SEAGM Balance"
            const allDivs = document.querySelectorAll('.channel, [class*="payment"]');
            for (const div of allDivs) {
                if (div.textContent.includes('SEAGM Balance')) {
                    div.click();
                    return true;
                }
            }
            
            // Alternativa: buscar por imagen
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
        
        // ========== PASO 7: Click en Pay Now ==========
        log('7️⃣', 'Haciendo click en Pay Now...');
        
        await page.evaluate(() => {
            const payNowBtn = document.querySelector('.paynow input[type="submit"], label.paynow');
            if (payNowBtn) payNowBtn.click();
        });
        
        await sleep(2000);
        
        // ========== PASO 8: Ingresar contraseña de confirmación ==========
        log('8️⃣', 'Ingresando contraseña de confirmación...');
        
        // Esperar el popup/form de contraseña
        await page.waitForSelector('#password, input[name="password"]', { timeout: 10000 }).catch(() => {});
        
        const passwordInput = await page.$('#password');
        if (passwordInput) {
            await passwordInput.click({ clickCount: 3 });
            await passwordInput.type(CONFIG.PASSWORD, { delay: 30 });
            await sleep(CONFIG.DELAY_RAPIDO);
            
            // Click en botón de pagar
            log('9️⃣', 'Confirmando pago...');
            await page.evaluate(() => {
                const submitBtn = document.querySelector('#submit_button input[type="submit"], #submit_button');
                if (submitBtn) submitBtn.click();
            });
        } else {
            log('⚠️', 'No se encontró campo de contraseña');
        }
        
        // ========== PASO 9: Esperar confirmación ==========
        log('🔟', 'Esperando confirmación...');
        await sleep(5000);
        
        // Buscar confirmación de "Completado"
        let orderId = null;
        let completado = false;
        
        for (let i = 0; i < 15; i++) {
            const resultado = await page.evaluate(() => {
                // Buscar "Completado"
                const completadoEl = document.querySelector('.stat.completed, [class*="completed"]');
                if (completadoEl && completadoEl.textContent.includes('Completado')) {
                    // Buscar número de orden
                    const pidEl = document.querySelector('.pid');
                    const orderId = pidEl ? pidEl.textContent.trim() : null;
                    return { completado: true, orderId };
                }
                
                // Buscar error
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
            // Verificar la URL actual
            const finalUrl = page.url();
            log('⚠️', 'URL final:', finalUrl);
            
            // Tomar screenshot para debug
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
        
        // Tomar screenshot para debug
        try {
            const screenshotPath = `./error_${Date.now()}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            log('📸', `Screenshot de error: ${screenshotPath}`);
        } catch (se) {}
        
        return { success: false, error: e.message };
    }
}

// ========== COLA DE PROCESAMIENTO ==========
async function procesarCola() {
    if (procesando || cola.length === 0) return;
    
    procesando = true;
    
    while (cola.length > 0) {
        const item = cola.shift();
        const { datos, resolve } = item;
        
        log('⚡', `Procesando de cola (quedan ${cola.length})`);
        
        const resultado = await ejecutarRecarga(
            datos.id_juego,
            datos.gold,
            !CONFIG.MODO_TEST
        );
        
        // Si fue exitoso, registrar en Supabase
        if (resultado.success && !resultado.test_mode) {
            try {
                // Actualizar pedido como entregado
                if (datos.pedido_id) {
                    await supabaseUpdate('pedidos_bs', 
                        { 
                            estado: 'entregado',
                            order_id_seagm: resultado.order_id || null,
                            entregado_at: new Date().toISOString()
                        }, 
                        `?id=eq.${datos.pedido_id}`
                    );
                }
                
                // Registrar en tabla de recargas
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
        
        if (cola.length > 0) {
            await sleep(3000);
        }
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

// Estado
app.get('/', (req, res) => {
    res.json({ 
        status: 'ok',
        servicio: 'RECARGAR-BS-SEAGM',
        version: '1.0.0',
        plataforma: 'SEAGM',
        sesion_activa: sesionActiva,
        en_cola: cola.length,
        procesando,
        modo_test: CONFIG.MODO_TEST
    });
});

// Ping para warmup
app.get('/ping', (req, res) => {
    res.json({ pong: true, timestamp: Date.now() });
});

// Verificar sesión
app.get('/sesion', async (req, res) => {
    const activa = await verificarSesion();
    res.json({ 
        sesion_activa: activa,
        mensaje: activa ? 'Sesión SEAGM activa' : 'Necesitas iniciar sesión'
    });
});

// Guardar sesión
app.post('/guardar-sesion', async (req, res) => {
    try {
        await guardarCookies();
        sesionActiva = true;
        res.json({ success: true, mensaje: 'Sesión SEAGM guardada' });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// Cargar cookies desde POST (para Railway donde no hay UI)
app.post('/cargar-cookies', async (req, res) => {
    try {
        const { cookies } = req.body;
        
        if (!cookies || !Array.isArray(cookies)) {
            return res.json({ success: false, error: 'Envía un array de cookies en el body: { "cookies": [...] }' });
        }
        
        if (!page) {
            return res.json({ success: false, error: 'Navegador no inicializado' });
        }
        
        // Cargar cookies en el navegador
        await page.setCookie(...cookies);
        log('🍪', `${cookies.length} cookies cargadas via POST`);
        
        // Guardar en archivo
        fs.writeFileSync(CONFIG.COOKIES_FILE, JSON.stringify(cookies, null, 2));
        log('💾', 'Cookies guardadas en archivo');
        
        // Recargar página y verificar sesión
        await page.goto(CONFIG.URL_BLOOD_STRIKE, { waitUntil: 'networkidle2', timeout: CONFIG.TIMEOUT });
        await sleep(2000);
        await cerrarPopups();
        
        const logueado = await verificarSesion();
        
        res.json({ 
            success: logueado, 
            mensaje: logueado ? 'Cookies cargadas y sesión activa' : 'Cookies cargadas pero sesión no válida',
            sesion_activa: logueado
        });
    } catch (e) {
        log('❌', 'Error cargando cookies:', e.message);
        res.json({ success: false, error: e.message });
    }
});

// Forzar login
app.post('/login', async (req, res) => {
    log('🔐', 'Login SEAGM solicitado');
    try {
        const exito = await hacerLogin();
        res.json({ 
            success: exito, 
            mensaje: exito ? 'Login exitoso' : 'Login falló'
        });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// TEST - Verificar flujo sin comprar
app.post('/test', async (req, res) => {
    const { id_juego, gold } = req.body;
    
    if (!id_juego || !gold) {
        return res.json({ success: false, error: 'Faltan datos (id_juego, gold)' });
    }
    
    log('🧪', 'TEST SOLICITADO');
    
    const resultado = await ejecutarRecarga(id_juego, parseInt(gold), false);
    res.json({ ...resultado, test_mode: true });
});

// RECARGA - Ejecutar recarga real
app.post('/recarga', async (req, res) => {
    const { id_juego, gold, pedido_id } = req.body;
    
    if (!id_juego || !gold) {
        return res.json({ success: false, error: 'Faltan datos (id_juego, gold)' });
    }
    
    log('🎯', `RECARGA SOLICITADA: ID=${id_juego} Gold=${gold}`);
    
    const resultado = await agregarACola({
        id_juego,
        gold: parseInt(gold),
        pedido_id
    });
    
    res.json(resultado);
});

// Paquetes disponibles
app.get('/paquetes', (req, res) => {
    const paquetes = Object.entries(PAQUETES_SEAGM).map(([gold, info]) => ({
        gold: parseInt(gold),
        nombre: info.nombre,
        precio_usd: info.precio,
        sku: info.sku
    }));
    
    res.json({
        success: true,
        plataforma: 'SEAGM',
        paquetes
    });
});

// Balance SEAGM (intentar obtener)
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
        
        res.json({ 
            success: !!balance, 
            balance: balance || 'No disponible',
            sesion_activa: sesionActiva
        });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// ========== INICIO ==========
async function start() {
    console.log('\n');
    log('⚔️', '═'.repeat(50));
    log('⚔️', 'RECARGAR-BS-SEAGM v1.0 - Blood Strike / SEAGM');
    log('⚔️', '═'.repeat(50));
    log('📍', `Entorno: ${process.env.RAILWAY_ENVIRONMENT ? 'Railway' : 'Local'}`);
    log('📍', `Puerto: ${CONFIG.PORT}`);
    
    if (CONFIG.MODO_TEST) {
        log('🧪', '═'.repeat(50));
        log('🧪', '⚠️  MODO TEST ACTIVADO');
        log('🧪', '   NO se realizan compras reales');
        log('🧪', '   Para producción: MODO_TEST=false');
        log('🧪', '═'.repeat(50));
    } else {
        log('🚨', '═'.repeat(50));
        log('🚨', '💰 MODO PRODUCCIÓN ACTIVO');
        log('🚨', '   Las compras SÍ son reales');
        log('🚨', '   Se usará SEAGM Balance');
        log('🚨', '═'.repeat(50));
    }
    
    await initBrowser();
    
    app.listen(CONFIG.PORT, '0.0.0.0', () => {
        console.log('');
        log('⚡', `Servidor listo en puerto ${CONFIG.PORT}`);
        console.log('');
        log('📋', 'Endpoints:');
        console.log('      GET  /              - Estado del servidor');
        console.log('      GET  /ping          - Warmup');
        console.log('      GET  /sesion        - Verificar sesión');
        console.log('      GET  /paquetes      - Ver paquetes disponibles');
        console.log('      GET  /balance       - Ver balance SEAGM');
        console.log('      POST /login         - Forzar login');
        console.log('      POST /guardar-sesion- Guardar cookies');
        console.log('      POST /test          - 🧪 Probar sin comprar');
        console.log('      POST /recarga       - ⚔️ Recarga real');
        console.log('');
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

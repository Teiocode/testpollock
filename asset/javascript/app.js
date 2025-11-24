'use strict';

// ============================================================
// 1. CONFIGURATION
// ============================================================

const PALETTE = ['#FF0000', '#0000FF', '#FFD700', '#32CD32', '#9400D3', '#FF8C00', '#00CED1'];

const POSSIBLE_ROLES = [
    { id: 'nose', label: 'TÊTE', keyIdx: 0 },
    { id: 'centroid', label: 'TORSE', keyIdx: -1 }, 
    { id: 'rightAnkle', label: 'PIED DROIT', keyIdx: 14 },
    { id: 'leftAnkle', label: 'PIED GAUCHE', keyIdx: 13 }
];

let videoEl, poseNet, pg;
let poses = [];
let painters = [];
let bgMode = 0; 
let modeTimer = 0;
const RESET_DELAY = 15000;

// Variables P2P
let myPeer;
let peerId = null; 
let targetId = null; 

// DÉTECTION : Est-ce qu'on est le téléphone (Visiteur) ou l'Ordi (Installation) ?
const urlParams = new URLSearchParams(window.location.search);
targetId = urlParams.get('id'); // Si on a un ID dans l'URL, c'est qu'on est le visiteur
const isMobileViewer = (targetId !== null);

// ============================================================
// 2. CLASSE PAINTER (Retour à la logique originale + Profondeur subtile)
// ============================================================
class Painter {
    constructor(id) {
        this.id = id;
        this.assignRandomRole(); 
        this.color = color(random(PALETTE));
        this.pos = createVector(width / 2, height / 2);
        this.prevPos = createVector(width / 2, height / 2);
        this.target = createVector(width / 2, height / 2);
        this.rawTarget = createVector(width / 2, height / 2);
        this.vel = createVector(0, 0);
        this.acc = createVector(0, 0);
        this.maxSpeed = 30; this.maxForce = 0.25; 
        
        // Profondeur subtile (1.0 = normal)
        this.scaleFactor = 1.0; 
        this.targetScale = 1.0; 
        
        this.lastMoveTime = Date.now(); 
        this.isActive = false; 
    }

    assignRandomRole() {
        this.role = random(POSSIBLE_ROLES);
        this.color = color(random(PALETTE)); 
    }

    respawn(x, y) {
        this.pos.set(x, y); this.prevPos.set(x, y); this.target.set(x, y); this.rawTarget.set(x, y);
        this.lastMoveTime = Date.now(); this.assignRandomRole(); 
    }

    update(rawX, rawY, newScale) {
        this.isActive = true;
        this.rawTarget.set(rawX, rawY);

        this.target.x = lerp(this.target.x, this.rawTarget.x, 0.3);
        this.target.y = lerp(this.target.y, this.rawTarget.y, 0.3);
        
        // Mise à jour douce de la taille
        if (newScale) this.targetScale = newScale;
        this.scaleFactor = lerp(this.scaleFactor, this.targetScale, 0.1);

        let desired = p5.Vector.sub(this.target, this.pos);
        let d = desired.mag();
        if (d < 100) desired.setMag(map(d, 0, 100, 0, this.maxSpeed));
        else desired.setMag(this.maxSpeed);

        let steer = p5.Vector.sub(desired, this.vel); steer.limit(this.maxForce);
        this.acc.add(steer); this.vel.add(this.acc);
        this.prevPos = this.pos.copy(); this.pos.add(this.vel); this.acc.mult(0);

        if (this.vel.mag() > 2.5) this.lastMoveTime = Date.now();
    }

    drawPaint(layer) {
        if (!this.isActive) return;

        let speed = this.vel.mag();
        let distMoved = dist(this.prevPos.x, this.prevPos.y, this.pos.x, this.pos.y);
        let timeStill = Date.now() - this.lastMoveTime;
        
        const WAIT_TIME = 1000; 
        // J'ai remis TA valeur originale (120), juste multipliée par la profondeur
        const MAX_BLOT_RADIUS = 120 * this.scaleFactor;

        // --- CAS 1 : TACHE (IMMOBILE) - LOGIQUE ORIGINALE ---
        if (timeStill > WAIT_TIME) {
            layer.noStroke();
            let growthDuration = timeStill - WAIT_TIME;
            let alphaVal = min(map(growthDuration, 0, 500, 0, 200), 200);
            
            let c = color(this.color); c.setAlpha(alphaVal); layer.fill(c);

            layer.push();
            layer.translate(this.pos.x, this.pos.y);
            layer.beginShape();
            
            // TON calcul original : 15 + (temps * 0.15)
            // Je multiplie juste le résultat final par scaleFactor
            let baseRadius = (15 + (growthDuration * 0.15));
            let currentRadius = min(baseRadius, MAX_BLOT_RADIUS); 

            // Dessin de la forme (noise)
            for (let a = 0; a < TWO_PI; a += 0.4) {
                let xoff = map(cos(a), -1, 1, 0, 2); 
                let yoff = map(sin(a), -1, 1, 0, 2);
                let noiseVal = noise(xoff + this.id, yoff + this.id, frameCount * 0.01);
                let r = currentRadius + map(noiseVal, 0, 1, -currentRadius/5, currentRadius/5);
                
                // Application de la profondeur ici
                r = r * this.scaleFactor; 
                
                layer.vertex(r * cos(a), r * sin(a));
            }
            layer.endShape(CLOSE);
            layer.pop();
        }
        // --- CAS 2 : TRAIT (MOUVEMENT) ---
        else if (distMoved > 2) { 
            let strokeW = map(speed, 0, this.maxSpeed, 35, 4);
            strokeW = constrain(strokeW, 4, 45);
            strokeW = strokeW * this.scaleFactor; // Profondeur

            layer.stroke(this.color);
            layer.strokeWeight(strokeW);
            layer.strokeCap(ROUND);
            layer.strokeJoin(ROUND);
            layer.line(this.prevPos.x, this.prevPos.y, this.pos.x, this.pos.y);

            if (speed > 20 && random() > 0.9) {
                layer.noStroke();
                let dripCol = color(this.color); dripCol.setAlpha(180); layer.fill(dripCol);
                let rs = random(2, 8) * this.scaleFactor;
                layer.ellipse(this.pos.x + random(-30, 30)*this.scaleFactor, this.pos.y + random(-30, 30)*this.scaleFactor, rs, rs);
            }
        }
    }
    
    drawUI() {
        if (!this.isActive) return;
        noStroke(); fill(255, 200);
        let textSizeScaled = constrain(12 * this.scaleFactor, 8, 16);
        textSize(textSizeScaled); textStyle(BOLD);
        drawingContext.shadowBlur = 4; drawingContext.shadowColor = "black";
        text(this.role.label, this.pos.x + (15 * this.scaleFactor), this.pos.y);
        drawingContext.shadowBlur = 0;

        let timeStill = Date.now() - this.lastMoveTime;
        if (timeStill > 0 && timeStill < 1000) {
             noFill(); stroke(255, 180); strokeWeight(3 * this.scaleFactor);
             let rad = 25 * this.scaleFactor; let progress = map(timeStill, 0, 1000, 0, TWO_PI);
             arc(this.pos.x, this.pos.y, rad, rad, -HALF_PI, -HALF_PI + progress);
        }
    }
}

// ============================================================
// 3. SETUP (ROUTAGE ENTRE ORDI ET MOBILE)
// ============================================================

function setup() {
    // Si l'URL contient "?id=...", on charge la "Page Galerie" sur mobile
    if (isMobileViewer) {
        setupMobileViewer();
        noCanvas(); // On n'affiche pas P5JS sur le mobile
        return;     
    }

    // Sinon, on lance l'installation normale sur l'ordi
    setupDesktopInstallation();
}

// --- PARTIE MOBILE (LA "AUTRE PAGE") ---
function setupMobileViewer() {
    // On cache tout sauf l'interface de réception
    document.getElementById('mobile-receiver').classList.remove('hidden');
    
    // Initialiser PeerJS
    let receiverPeer = new Peer();

    receiverPeer.on('open', (id) => {
        console.log("Mobile prêt. Connexion à l'ID:", targetId);
        
        // Connexion à l'ordinateur
        let conn = receiverPeer.connect(targetId);

        conn.on('open', () => {
            console.log("Connecté ! Demande de l'image...");
            conn.send('SEND_PNG'); // On demande poliment l'image
        });

        conn.on('data', (data) => {
            // RECEPTION DU FICHIER PNG
            if (data.file) {
                // On change le texte
                let statusText = document.getElementById('status-msg');
                statusText.innerText = "Œuvre reçue !";
                statusText.classList.remove('animate-pulse');
                statusText.classList.add('text-green-500');
                
                // On affiche l'image
                let imgEl = document.getElementById('received-image');
                let url = URL.createObjectURL(data.file); // Création du lien blob
                imgEl.src = url;
                imgEl.classList.remove('hidden');
            }
        });
    });
}

// --- PARTIE ORDINATEUR (INSTALLATION) ---
function setupDesktopInstallation() {
    pixelDensity(1); 
    let canvas = createCanvas(windowWidth, windowHeight);
    canvas.parent('canvas-container');
    pg = createGraphics(windowWidth, windowHeight);
    
    videoEl = document.getElementById('video-feed');
    let capture = createCapture(VIDEO, function(stream) {
        videoEl.srcObject = stream; videoEl.play();
    });
    capture.size(640, 480); capture.hide();

    // Configuration PeerJS (PC)
    myPeer = new Peer();
    
    myPeer.on('open', (id) => {
        peerId = id; 
        console.log("ID Installation : " + peerId);
    });

    myPeer.on('connection', (conn) => {
        // Quand le mobile se connecte, on attend son signal
        conn.on('data', (data) => {
            if (data === 'SEND_PNG') {
                sendArtworkToMobile(conn);
            }
        });
    });

    let options = {
        architecture: 'MobileNetV1', imageScaleFactor: 0.3, outputStride: 16,
        flipHorizontal: true, minConfidence: 0.25, scoreThreshold: 0.25, detectionType: 'multiple'
    };
    poseNet = ml5.poseNet(capture, options, modelReady);
    poseNet.on('pose', function(results) { poses = results; });

    for(let i=0; i<6; i++) { painters.push(new Painter(i)); }
}

// Fonction d'envoi de l'image (PNG)
function sendArtworkToMobile(connection) {
    let canvasDom = document.getElementById('defaultCanvas0'); 
    
    // EXPORT EN PNG (Haute qualité, fond transparent géré)
    canvasDom.toBlob(function(blob) {
        console.log("Envoi du PNG : " + (blob.size / 1024).toFixed(2) + " Ko");
        
        connection.send({ 
            file: blob,
            type: 'image/png' // On force le type PNG
        });
        
        // Fermer le popup sur l'ordi
        setTimeout(closeQrPopup, 2000);

    }, 'image/png'); // Format PNG spécifié ici
}


// ============================================================
// 4. BOUCLE DE DESSIN (DRAW)
// ============================================================

function draw() {
    if (isMobileViewer) return; // Le mobile ne dessine rien

    if (bgMode !== 0) { if (Date.now() - modeTimer > RESET_DELAY) bgMode = 0; }
    if (bgMode === 0) { background(255); videoEl.style.opacity = 0; } 
    else if (bgMode === 1) { background(0); videoEl.style.opacity = 0; } 
    else if (bgMode === 2) { clear(); videoEl.style.opacity = 1; }

    image(pg, 0, 0);
    painters.forEach(p => p.isActive = false);

    for (let i = 0; i < poses.length; i++) {
        if (i < painters.length) {
            let pose = poses[i].pose; let painter = painters[i];
            
            // Filtre anti-fantôme conservé (c'est important)
            if (!isPoseValid(pose)) continue;

            let data = getBodyPartCoordinates(pose, painter.role);
            let depthScale = calculateDepthScale(pose);

            if (data.score > 0.2) {
                let targetX = data.x; let targetY = data.y;
                if (dist(painter.pos.x, painter.pos.y, targetX, targetY) > 300) {
                    painter.respawn(targetX, targetY);
                    data = getBodyPartCoordinates(pose, painter.role); targetX = data.x; targetY = data.y;
                }
                painter.update(targetX, targetY, depthScale);
                painter.drawPaint(pg); painter.drawUI();
            }
        }
    }
}

// ============================================================
// 5. FONCTIONS UTILITAIRES
// ============================================================

function modelReady() {
    let status = select('#status'); 
    if(status) { status.html('Système Prêt'); status.class('text-yellow-400 font-mono text-sm font-bold'); }
}

function keyPressed() {
    if (isMobileViewer) return; 

    if (key === ' ') { 
        bgMode++; if (bgMode > 2) bgMode = 0; if (bgMode === 1 || bgMode === 2) modeTimer = Date.now();
    }
    
    // TOUCHE 'E' : Génère le QR Code vers la "page" mobile
    if (key === 'e' || key === 'E') {
        generatePageQrCode();
    }
}

function generatePageQrCode() {
    if (!peerId) { alert("Attente du réseau..."); return; }
    const overlay = document.getElementById('qr-overlay');
    const qrContainer = document.getElementById("qrcode-container");
    
    qrContainer.innerHTML = ""; 
    document.getElementById('qr-loading').classList.add('hidden'); 
    document.getElementById('qr-result').classList.remove('hidden'); 
    
    // Modification des textes du Popup
    document.querySelector('#qr-result h2').innerText = "Scanner pour voir l'œuvre";
    document.querySelector('#qr-result p').innerText = "Ouvre une page dédiée sur votre mobile";

    // URL : On pointe vers la même page mais avec l'ID en paramètre
    // Le code au début de 'setup' détectera cet ID et affichera la vue "MobileViewer"
    let cleanUrl = window.location.href.split('?')[0];
    let pageUrl = cleanUrl + "?id=" + peerId;

    new QRCode(qrContainer, {
        text: pageUrl, width: 200, height: 200,
        colorDark : "#000000", colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.L
    });

    overlay.classList.remove('hidden');
    setTimeout(() => overlay.classList.add('show'), 10);
}

function closeQrPopup() {
    const overlay = document.getElementById('qr-overlay');
    if(overlay) { overlay.classList.remove('show'); setTimeout(() => overlay.classList.add('hidden'), 300); }
}

function resetCanvas() { pg.clear(); painters.forEach(p => p.assignRandomRole()); }
function windowResized() { resizeCanvas(windowWidth, windowHeight); pg = createGraphics(windowWidth, windowHeight); }

function isPoseValid(pose) {
    if (pose.score < 0.2) return false; 
    let n = pose.keypoints[0]; let ls = pose.keypoints[5]; let rs = pose.keypoints[6];
    return (n.score > 0.3 || ls.score > 0.3 || rs.score > 0.3); 
}

function getBodyPartCoordinates(pose, role) {
    let x = 0, y = 0, score = 0; let usedLabel = role.label;
    let scaleX = width / 640; let scaleY = height / 480;
    if (role.id === 'centroid') {
        let ls = pose.keypoints[5]; let rs = pose.keypoints[6];
        if (ls.score > 0.1 && rs.score > 0.1) { 
            x = (ls.position.x + rs.position.x) / 2; y = (ls.position.y + rs.position.y) / 2; score = (ls.score + rs.score) / 2;
        }
    } else {
        let kp = pose.keypoints[role.keyIdx]; if (kp) { x = kp.position.x; y = kp.position.y; score = kp.score; }
    }
    if (score < 0.2) {
        let ls = pose.keypoints[5]; let rs = pose.keypoints[6];
        if (ls.score > 0.1 && rs.score > 0.1) {
            x = (ls.position.x + rs.position.x) / 2; y = (ls.position.y + rs.position.y) / 2; score = (ls.score + rs.score) / 2; usedLabel = "TORSE"; 
        }
    }
    return { x: x * scaleX, y: y * scaleY, score, label: usedLabel };
}

function calculateDepthScale(pose) {
    let ls = pose.keypoints[5]; let rs = pose.keypoints[6];
    if (ls.score > 0.15 && rs.score > 0.15) {
        let d = dist(ls.position.x, ls.position.y, rs.position.x, rs.position.y);
        // Profondeur ajustée pour être moins violente
        return map(d, 40, 200, 0.6, 1.4, true); 
    }
    return null; 
}

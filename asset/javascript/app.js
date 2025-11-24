'use strict';

// --- CONFIGURATION ---
const PALETTE = ['#FF0000', '#0000FF', '#FFD700', '#32CD32', '#9400D3', '#FF8C00', '#00CED1'];
const POSSIBLE_ROLES = [
    { id: 'nose', label: 'TÊTE', keyIdx: 0 },
    { id: 'centroid', label: 'TORSE', keyIdx: -1 }, 
    { id: 'rightAnkle', label: 'PIED DROIT', keyIdx: 14 },
    { id: 'leftAnkle', label: 'PIED GAUCHE', keyIdx: 13 }
];

// Variables Globales
let videoEl, poseNet, pg;
let poses = [];
let painters = [];
let bgMode = 0; // 0=Blanc, 1=Noir, 2=Vidéo
let modeTimer = 0;
const RESET_DELAY = 15000;

// Variables P2P (Tunnel)
let myPeer;
let peerId = null; // Mon ID
let targetId = null; // L'ID à qui se connecter (si on est le téléphone)

// --- DÉTECTION DU MODE (PC ou MOBILE ?) ---
// On regarde si l'URL contient "?id=..."
const urlParams = new URLSearchParams(window.location.search);
targetId = urlParams.get('id');
const isMobileReceiver = (targetId !== null);

// ============================================================
// CLASSE PAINTER (Code inchangé pour l'art)
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
        this.maxSpeed = 30; 
        this.maxForce = 0.25; 
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
        this.pos.set(x, y);
        this.prevPos.set(x, y);
        this.target.set(x, y);
        this.rawTarget.set(x, y);
        this.lastMoveTime = Date.now(); 
        this.assignRandomRole(); 
    }
    update(rawX, rawY, newScale) {
        this.isActive = true;
        this.rawTarget.set(rawX, rawY);
        this.target.x = lerp(this.target.x, this.rawTarget.x, 0.3);
        this.target.y = lerp(this.target.y, this.rawTarget.y, 0.3);
        if (newScale) this.targetScale = newScale;
        this.scaleFactor = lerp(this.scaleFactor, this.targetScale, 0.1);
        let desired = p5.Vector.sub(this.target, this.pos);
        let d = desired.mag();
        if (d < 100) {
            let m = map(d, 0, 100, 0, this.maxSpeed);
            desired.setMag(m);
        } else {
            desired.setMag(this.maxSpeed);
        }
        let steer = p5.Vector.sub(desired, this.vel);
        steer.limit(this.maxForce);
        this.acc.add(steer);
        this.vel.add(this.acc);
        this.prevPos = this.pos.copy();
        this.pos.add(this.vel);
        this.acc.mult(0);
        if (this.vel.mag() > 2.5) this.lastMoveTime = Date.now();
    }
    drawPaint(layer) {
        if (!this.isActive) return;
        let speed = this.vel.mag();
        let distMoved = dist(this.prevPos.x, this.prevPos.y, this.pos.x, this.pos.y);
        let timeStill = Date.now() - this.lastMoveTime;
        const WAIT_TIME = 1000; 
        const MAX_BLOT_RADIUS = 120 * this.scaleFactor; 

        if (timeStill > WAIT_TIME) {
            layer.noStroke();
            let growthDuration = timeStill - WAIT_TIME;
            let alphaVal = min(map(growthDuration, 0, 500, 0, 200), 200);
            let c = color(this.color);
            c.setAlpha(alphaVal);
            layer.fill(c);
            layer.push();
            layer.translate(this.pos.x, this.pos.y);
            layer.beginShape();
            let baseRadius = (15 + (growthDuration * 0.15));
            let currentRadius = min(baseRadius, MAX_BLOT_RADIUS) * this.scaleFactor;
            for (let a = 0; a < TWO_PI; a += 0.4) {
                let xoff = map(cos(a), -1, 1, 0, 2);
                let yoff = map(sin(a), -1, 1, 0, 2);
                let noiseVal = noise(xoff + this.id, yoff + this.id, frameCount * 0.01);
                let r = currentRadius + map(noiseVal, 0, 1, -currentRadius/5, currentRadius/5);
                layer.vertex(r * cos(a), r * sin(a));
            }
            layer.endShape(CLOSE);
            layer.pop();
        }
        else if (distMoved > 2) { 
            let strokeW = map(speed, 0, this.maxSpeed, 35, 4);
            strokeW = constrain(strokeW, 4, 45) * this.scaleFactor;
            layer.stroke(this.color);
            layer.strokeWeight(strokeW);
            layer.strokeCap(ROUND);
            layer.strokeJoin(ROUND);
            layer.line(this.prevPos.x, this.prevPos.y, this.pos.x, this.pos.y);
            if (speed > 20 && random() > 0.9) {
                layer.noStroke();
                let dripCol = color(this.color);
                dripCol.setAlpha(180);
                layer.fill(dripCol);
                let rs = random(2, 8) * this.scaleFactor; 
                layer.ellipse(this.pos.x + random(-30, 30)*this.scaleFactor, this.pos.y + random(-30, 30)*this.scaleFactor, rs, rs);
            }
        }
    }
    drawUI() {
        if (!this.isActive) return;
        noStroke();
        fill(255, 200);
        let textSizeScaled = constrain(12 * this.scaleFactor, 8, 16);
        textSize(textSizeScaled);
        textStyle(BOLD);
        drawingContext.shadowBlur = 4;
        drawingContext.shadowColor = "black";
        text(this.role.label, this.pos.x + (15 * this.scaleFactor), this.pos.y);
        drawingContext.shadowBlur = 0;
        let timeStill = Date.now() - this.lastMoveTime;
        if (timeStill > 0 && timeStill < 1000) {
             noFill();
             stroke(255, 180);
             strokeWeight(3 * this.scaleFactor);
             let rad = 25 * this.scaleFactor;
             let progress = map(timeStill, 0, 1000, 0, TWO_PI);
             arc(this.pos.x, this.pos.y, rad, rad, -HALF_PI, -HALF_PI + progress);
        }
    }
}

// ============================================================
// SETUP ET DRAW
// ============================================================

function setup() {
    // SI ON EST SUR LE MOBILE (Récepteur)
    if (isMobileReceiver) {
        setupMobileReceiver();
        noCanvas(); // Pas de p5.js canvas sur le mobile
        return;     // ON ARRÊTE TOUT LE RESTE DU SETUP
    }

    // SI ON EST SUR L'ORDINATEUR (Émetteur / Installation)
    setupDesktopInstallation();
}

// --- LOGIQUE MOBILE (RÉCEPTEUR) ---
function setupMobileReceiver() {
    document.getElementById('mobile-receiver').classList.remove('hidden');
    
    // Initialiser PeerJS (Créer un ID au hasard pour le téléphone)
    let receiverPeer = new Peer();

    receiverPeer.on('open', (id) => {
        console.log("Mobile prêt. Connexion à l'ordinateur ID:", targetId);
        document.getElementById('status-msg').innerText = "Connexion établie. En attente de l'image...";
        
        // Se connecter à l'ordinateur
        let conn = receiverPeer.connect(targetId);

        conn.on('open', () => {
            console.log("Connecté à l'installation !");
            conn.send('HELLO_FROM_MOBILE'); // Petit coucou pour dire qu'on est là
        });

        // QUAND ON REÇOIT L'IMAGE
        conn.on('data', (data) => {
            console.log("Données reçues !");
            if (data.image) {
                document.getElementById('status-msg').innerText = "Image reçue !";
                document.getElementById('status-msg').classList.remove('animate-pulse');
                document.getElementById('status-msg').classList.add('text-green-500');
                
                let imgEl = document.getElementById('received-image');
                imgEl.src = data.image;
                imgEl.classList.remove('hidden');
            }
        });
    });
}

// --- LOGIQUE ORDINATEUR (INSTALLATION) ---
function setupDesktopInstallation() {
    pixelDensity(1); 
    let canvas = createCanvas(windowWidth, windowHeight);
    canvas.parent('canvas-container');
    
    pg = createGraphics(windowWidth, windowHeight);
    
    videoEl = document.getElementById('video-feed');
    let capture = createCapture(VIDEO, function(stream) {
        videoEl.srcObject = stream; 
        videoEl.play();
    });
    capture.size(640, 480); 
    capture.hide();

    // Initialiser PeerJS pour l'ordinateur
    // On ne demande pas d'ID spécifique, le serveur PeerJS nous en donnera un
    myPeer = new Peer();
    
    myPeer.on('open', (id) => {
        peerId = id; // On garde notre ID en mémoire pour le mettre dans le QR Code plus tard
        console.log("Mon ID de partage est : " + peerId);
    });

    // Écouter les connexions entrantes (quand un téléphone scanne)
    myPeer.on('connection', (conn) => {
        console.log("Un téléphone s'est connecté !");
        
        // Dès qu'on est connecté, on lui envoie l'image actuelle !
        // On attend 500ms pour être sûr que la connexion est stable
        setTimeout(() => {
            sendCurrentArtwork(conn);
        }, 500);
    });

    let options = {
        architecture: 'MobileNetV1',
        imageScaleFactor: 0.3, 
        outputStride: 16,
        flipHorizontal: true,
        minConfidence: 0.25, 
        scoreThreshold: 0.25, 
        detectionType: 'multiple'
    };
    
    poseNet = ml5.poseNet(capture, options, modelReady);
    poseNet.on('pose', function(results) { poses = results; });

    for(let i=0; i<6; i++) {
        painters.push(new Painter(i));
    }
}

function sendCurrentArtwork(connection) {
    // 1. Récupérer l'image du canvas en Base64
    let canvasDom = document.getElementById('defaultCanvas0'); 
    let dataUrl = canvasDom.toDataURL('image/png');
    
    // 2. Envoyer via le tunnel P2P
    connection.send({ image: dataUrl });
    console.log("Image envoyée au téléphone !");
    
    // Fermer le popup sur l'ordi après 2 secondes
    setTimeout(closeQrPopup, 2000);
}


function draw() {
    // Si on est sur mobile, on ne dessine rien (boucle arrêtée)
    if (isMobileReceiver) return;

    if (bgMode !== 0) {
        if (Date.now() - modeTimer > RESET_DELAY) bgMode = 0;
    }

    if (bgMode === 0) { background(255); videoEl.style.opacity = 0; } 
    else if (bgMode === 1) { background(0); videoEl.style.opacity = 0; } 
    else if (bgMode === 2) { clear(); videoEl.style.opacity = 1; }

    image(pg, 0, 0);
    painters.forEach(p => p.isActive = false);

    for (let i = 0; i < poses.length; i++) {
        if (i < painters.length) {
            let pose = poses[i].pose;
            let painter = painters[i];
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

// --- FONCTIONS UTILITAIRES ---

function modelReady() {
    let status = select('#status'); 
    if(status) { status.html('Système Prêt'); status.class('text-yellow-400 font-mono text-sm font-bold'); }
}

function keyPressed() {
    if (isMobileReceiver) return; // Pas de touche sur mobile

    if (key === ' ') { 
        bgMode++; 
        if (bgMode > 2) bgMode = 0; 
        if (bgMode === 1 || bgMode === 2) modeTimer = Date.now();
    }
    
    if (key === 'e' || key === 'E') {
        generateP2PQrCode();
    }
}

// Génération du QR Code P2P
function generateP2PQrCode() {
    if (!peerId) {
        alert("Erreur: Le système de partage n'est pas encore prêt. Attendez quelques secondes.");
        return;
    }

    // Afficher le popup
    const overlay = document.getElementById('qr-overlay');
    const qrContainer = document.getElementById("qrcode-container");
    // On nettoie les anciens contenus
    qrContainer.innerHTML = ""; 
    document.getElementById('qr-loading').classList.add('hidden'); // Cacher le loading
    document.getElementById('qr-result').classList.remove('hidden'); // Afficher direct

    // URL MAGIQUE : Adresse actuelle + ID du Peer
    // On enlève d'anciens paramètres s'il y en a
    let cleanUrl = window.location.href.split('?')[0];
    let shareUrl = cleanUrl + "?id=" + peerId;

    console.log("URL de partage : ", shareUrl);

    // Générer QR
    new QRCode(qrContainer, {
        text: shareUrl,
        width: 200, height: 200,
        colorDark : "#000000", colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.L
    });

    overlay.classList.remove('hidden');
    setTimeout(() => overlay.classList.add('show'), 10);
}

function closeQrPopup() {
    const overlay = document.getElementById('qr-overlay');
    overlay.classList.remove('show');
    setTimeout(() => overlay.classList.add('hidden'), 300);
}

function resetCanvas() { pg.clear(); painters.forEach(p => p.assignRandomRole()); }
function windowResized() { resizeCanvas(windowWidth, windowHeight); pg = createGraphics(windowWidth, windowHeight); }

function isPoseValid(pose) {
    if (pose.score < 0.2) return false; 
    let nose = pose.keypoints[0]; let leftShoulder = pose.keypoints[5]; let rightShoulder = pose.keypoints[6];
    return (nose.score > 0.3 || leftShoulder.score > 0.3 || rightShoulder.score > 0.3); 
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
        let kp = pose.keypoints[role.keyIdx];
        if (kp) { x = kp.position.x; y = kp.position.y; score = kp.score; }
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
    let leftShoulder = pose.keypoints[5]; let rightShoulder = pose.keypoints[6];
    if (leftShoulder.score > 0.15 && rightShoulder.score > 0.15) {
        let d = dist(leftShoulder.position.x, leftShoulder.position.y, rightShoulder.position.x, rightShoulder.position.y);
        return map(d, 40, 200, 0.4, 2.0, true);
    }
    return null; 
}
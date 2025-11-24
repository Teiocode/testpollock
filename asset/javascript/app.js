'use strict';

// ============================================================
// 0. P2P + QR CODE (AJOUTÉ)
// ============================================================

let peer = new Peer();     // Création du peer
let p2pConnection = null;  // Connexion active si un mobile se connecte

peer.on("open", id => {
    console.log("PeerJS prêt, ID =", id);
});

function openQrPopup(peerID) {
    document.getElementById("qrcode-container").innerHTML = ""; // reset
    new QRCode(document.getElementById("qrcode-container"), {
        text: window.location.origin + "/receiver.html#" + peerID,
        width: 220,
        height: 220
    });

    document.getElementById("qr-result").classList.remove("hidden");
    document.getElementById("qr-loading").classList.add("hidden");

    const overlay = document.getElementById("qr-overlay");
    overlay.classList.remove("hidden");
    setTimeout(() => overlay.classList.add("show"), 20);
}

function closeQrPopup() {
    const overlay = document.getElementById("qr-overlay");
    overlay.classList.remove("show");
    setTimeout(() => overlay.classList.add("hidden"), 300);
}



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

// Gestion des Fonds (Blanc / Noir / Vidéo)
let bgMode = 0; 
let modeTimer = 0;
const RESET_DELAY = 15000; // 15 secondes avant retour automatique au blanc



// ============================================================
// 2. CLASSE PAINTER (identique à ton code)
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

        if (this.vel.mag() > 2.5) {
            this.lastMoveTime = Date.now();
        }
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
            let currentRadius = min(baseRadius, MAX_BLOT_RADIUS);

            for (let a = 0; a < TWO_PI; a += 0.4) {
                let xoff = map(cos(a), -1, 1, 0, 2);
                let yoff = map(sin(a), -1, 1, 0, 2);
                let noiseVal = noise(xoff + this.id, yoff + this.id, frameCount * 0.01);
                
                let r = (currentRadius + map(noiseVal, 0, 1, -currentRadius/5, currentRadius/5)) * this.scaleFactor;
                layer.vertex(r * cos(a), r * sin(a));
            }
            layer.endShape(CLOSE);
            layer.pop();
        }
        
        else if (distMoved > 2) { 
            let strokeW = map(speed, 0, this.maxSpeed, 35, 4);
            strokeW = constrain(strokeW, 4, 45);
            strokeW *= this.scaleFactor;

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
// 3. SETUP
// ============================================================

function setup() {
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
    poseNet.on('pose', function(results) {
        poses = results;
    });

    for(let i=0; i<6; i++) {
        painters.push(new Painter(i));
    }
}

function modelReady() {
    console.log("PoseNet prêt");
}



// ============================================================
// 4. DRAW
// ============================================================

function draw() {

    if (bgMode !== 0) {
        if (Date.now() - modeTimer > RESET_DELAY) bgMode = 0;
    }

    if (bgMode === 0) { 
        background(255);
        videoEl.style.opacity = 0; 
    } 
    else if (bgMode === 1) { 
        background(0);
        videoEl.style.opacity = 0; 
    } 
    else if (bgMode === 2) { 
        clear();
        videoEl.style.opacity = 1; 
    }

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
                let targetX = data.x;
                let targetY = data.y;

                if (dist(painter.pos.x, painter.pos.y, targetX, targetY) > 300) {
                    painter.respawn(targetX, targetY);
                    data = getBodyPartCoordinates(pose, painter.role); 
                    targetX = data.x; 
                    targetY = data.y;
                }

                painter.update(targetX, targetY, depthScale);
                
                painter.drawPaint(pg);
                painter.drawUI();
            }
        }
    }
}



// ============================================================
// 5. ÉVÉNEMENTS CLAVIER (MODIFIÉ)
// ============================================================

function keyPressed() {

    if (key === ' ') { 
        bgMode++; 
        if (bgMode > 2) bgMode = 0; 
        if (bgMode === 1 || bgMode === 2) modeTimer = Date.now();
    }

    // ========= NOUVEAU → Capture + QR Code + envoi P2P ========
    if (key === 'e' || key === 'E') {

        // 1) Convertit le calque en image
        const imgData = pg.elt.toDataURL("image/png");

        // 2) Ouvre le QR code avec l’ID PeerJS
        openQrPopup(peer.id);

        // 3) Attendre la connexion du mobile
        peer.on("connection", conn => {
            p2pConnection = conn;
            conn.on("open", () => {
                console.log("Téléphone connecté : envoi de l’image...");
                conn.send({ type: "image", data: imgData });
            });
        });
    }
}

function resetCanvas() {
    pg.clear(); 
    painters.forEach(p => p.assignRandomRole());
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    pg = createGraphics(windowWidth, windowHeight);
}

function isPoseValid(pose) {
    if (pose.score < 0.2) return false;
    let nose = pose.keypoints[0];
    let leftShoulder = pose.keypoints[5];
    let rightShoulder = pose.keypoints[6];
    return (nose.score > 0.3 || leftShoulder.score > 0.3 || rightShoulder.score > 0.3); 
}

function getBodyPartCoordinates(pose, role) {
    let x = 0, y = 0, score = 0;
    let usedLabel = role.label;
    let scaleX = width / 640;
    let scaleY = height / 480;

    if (role.id === 'centroid') {
        let ls = pose.keypoints[5];
        let rs = pose.keypoints[6];
        if (ls.score > 0.1 && rs.score > 0.1) { 
            x = (ls.position.x + rs.position.x) / 2;
            y = (ls.position.y + rs.position.y) / 2;
            score = (ls.score + rs.score) / 2;
        }
    } else {
        let kp = pose.keypoints[role.keyIdx];
        if (kp) {
            x = kp.position.x;
            y = kp.position.y;
            score = kp.score;
        }
    }
    
    if (score < 0.2) {
        let ls = pose.keypoints[5];
        let rs = pose.keypoints[6];
        if (ls.score > 0.1 && rs.score > 0.1) {
            x = (ls.position.x + rs.position.x) / 2;
            y = (ls.position.y + rs.position.y) / 2;
            score = (ls.score + rs.score) / 2;
            usedLabel = "TORSE"; 
        }
    }

    return { x: x * scaleX, y: y * scaleY, score, label: usedLabel };
}

function calculateDepthScale(pose) {
    let leftShoulder = pose.keypoints[5];
    let rightShoulder = pose.keypoints[6];
    
    if (leftShoulder.score > 0.15 && rightShoulder.score > 0.15) {
        let d = dist(leftShoulder.position.x, leftShoulder.position.y, rightShoulder.position.x, rightShoulder.position.y);
        return map(d, 40, 200, 0.6, 1.4, true);
    }
    return null; 
}

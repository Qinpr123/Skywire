// 等比缩放：将 832x1480 的设计尺寸在不裁剪情况下填充可视区域
(function() {
    function updateScale() {
        const container = document.getElementById('gameContainer');
        if (!container) return;

        const designWidth = Number(container.getAttribute('data-design-width')) || 832;
        const designHeight = Number(container.getAttribute('data-design-height')) || 1480;

        const vw = window.innerWidth;
        const vh = window.innerHeight;

        // 预留统一边距（可调），在非常小的屏幕会自动退化
        const margin = Math.max(8, Math.min(40, Math.floor(Math.min(vw, vh) * 0.04)));
        const usableW = Math.max(0, vw - margin * 2);
        const usableH = Math.max(0, vh - margin * 2);

        const scale = Math.min(usableW / designWidth, usableH / designHeight);

        // 居中 + 缩放，留白由 translate(-50%, -50%) + 缩放后自然产生
        container.style.transform = `translate(-50%, -50%) scale(${scale})`;
        container.style.top = '50%';
        container.style.left = '50%';
        document.body.classList.add('scaled-center');
    }

    window.addEventListener('resize', updateScale);
    window.addEventListener('orientationchange', updateScale);

    // 在 DOMContentLoaded 后初始化缩放
    document.addEventListener('DOMContentLoaded', updateScale);
})();

class TightropeGame {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.width = this.canvas.width;
        this.height = this.canvas.height;
        // 平衡旋转中心：以画布左下角为原点，向右416、向上430
        this.balancePivot = { x: 416, y: this.height - 430 };

        this.gameRunning = false;
        this.gamePaused = false;
        this.distance = 0;
        this.speed = 0.083;
        this.score = 0;
        this.highScore = parseInt(localStorage.getItem('tightropeHighScore') || 0);
        this.gameStarted = false;

        // 初始化音效系统
        this.audioContext = null;
        this.initAudio();

        this.player = {
            x: this.width / 2,
            y: this.height / 2,
            sway: 0,
            swaySpeed: 0,
            size: 40
        };

        this.tightrope = {
            x: this.width / 2,
            thickness: 6
        };

        this.wind = {
            force: 0,
            direction: 1,
            changeTimer: 0,
            changeInterval: 60
        };

        this.background = {
            offset: 0,
            speed: 1
        };

        // 美术素材
        this.images = { 
            bg: null, 
            gs: null, 
            pole: null, 
            powerUps: {
                bomb: null,
                fast: null,
                slow: null,
                keepBalance: null,
                disruptBalance: null
            },
            landscape: {
                left_d1: null,
                left_d2: null,
                left_d3: null,
                right_d1: null,
                right_d2: null
            },
            bg_cloud: null,
            ready: false, 
            loaded: 0 
        };
        
        // 音频对象
        this.audio = {
            bgMusic: null,
            loaded: 0,
            ready: false
        };
        this.loadImages();
        this.loadAudio();
        // 角色帧动画
        this.sprites = { manFrames: [], loaded: 0, total: 9, ready: false };
        this.loadManFrames();

        this.particles = [];
        this.landscape = [];
        this.landscapeSpeed = this.speed * 1; // 基础速度等于角色速度
        this.leftSpawnTimer = 0;
        this.leftSpawnInterval = 300 + Math.random() * 360; // 左边5-12秒随机间隔 (300-660帧)
        this.rightSpawnTimer = 0;
        this.rightSpawnInterval = 300 + Math.random() * 360; // 右边5-12秒随机间隔 (300-660帧)
        this.powerUps = [];
        this.powerUpSpawnTimer = 0;
        this.powerUpSpawnInterval = 20;
        this.activePowerUps = [];
        this.balanceRod = {
            baseLength: 0, // 原图基准长度，将在图片加载后设置
            length: 0, // 当前长度，将在图片加载后设置
            minLength: 0, // 最小长度（原图的50%），将在图片加载后设置
            maxLength: 0, // 最大长度（原图的150%），将在图片加载后设置
            extendSpeed: 2
        };
        this.keys = {};
        // 角色动画状态（步幅与帧）
        this.player.frameIndex = 0;
        this.player.stepAccumPx = 0;
        this.player.stepLengthPx = 20; // 每走20像素切下一帧（动画速度x2）
        this.player.spriteHeight = 120; // 若后续需要按高度定位可用（目前按贴图原始尺寸）

        this.init();
    }

    // 初始化音频系统
    initAudio() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.log('Web Audio API 不支持');
        }
    }

    // 播放游戏结束音效（低沉的失败音）
    playGameOverSound() {
        if (!this.audioContext) return;
        
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);
        
        oscillator.frequency.setValueAtTime(200, this.audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(100, this.audioContext.currentTime + 0.5);
        
        gainNode.gain.setValueAtTime(0.3, this.audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.5);
        
        oscillator.start(this.audioContext.currentTime);
        oscillator.stop(this.audioContext.currentTime + 0.5);
    }

    // 播放新纪录音效（鼓掌声音）
    playNewRecordSound() {
        try {
            // 创建音频元素播放鼓掌音效
            const clapSound = new Audio('claps.MP3');
            clapSound.volume = 0.7; // 设置音量为70%
            clapSound.play().catch(e => {
                console.warn('新纪录音效播放失败:', e);
            });
        } catch (e) {
            console.warn('无法加载新纪录音效文件:', e);
        }
    }

    loadManFrames() {
        const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
        for (let i = 1; i <= this.sprites.total; i++) {
            const img = new Image();
            img.onload = () => {
                this.sprites.loaded++;
                if (this.sprites.loaded >= this.sprites.total) {
                    this.sprites.ready = true;
                    this.checkAllResourcesLoaded(); // 检查所有资源是否加载完成
                }
            };
            img.src = `image/man_walk_${pad2(i)}.png`;
            this.sprites.manFrames.push(img);
        }
    }

    checkAllResourcesLoaded() {
        // 检查所有资源是否加载完成（图片、角色帧、音频）
        if (this.images.ready && this.sprites.ready && this.audio.ready) {
            // 延迟一点时间确保加载界面显示足够长
            setTimeout(() => {
                const loadingScreen = document.getElementById('loadingScreen');
                if (loadingScreen) {
                    loadingScreen.classList.add('hidden');
                    // 加载完成后移除加载界面元素
                    setTimeout(() => {
                        loadingScreen.style.display = 'none';
                    }, 500); // 等待淡出动画完成
                }
            }, 1000); // 显示加载界面至少1秒
        }
    }

    loadImages() {
        const setBgLayer = () => {
            // 设置页面全屏模糊背景层
            const el = document.getElementById('bgBlur');
            if (el && this.images.bg) {
                el.style.backgroundImage = `url(${this.images.bg.src})`;
            }
        };
        const onLoaded = () => {
            this.images.loaded++;
            if (this.images.loaded >= 14) { 
                this.images.ready = true; 
                setBgLayer(); 
                this.checkAllResourcesLoaded(); // 检查所有资源是否加载完成
            } // 3个背景图 + 5个道具图 + 5个背景运动元素图 + 1个云层图
        };
        const bg = new Image();
        bg.onload = onLoaded;
        bg.src = 'image/bg.png';
        const gs = new Image();
        gs.onload = onLoaded;
        gs.src = 'image/gs.png';
        
        const bg_start = new Image();
        bg_start.onload = onLoaded;
        bg_start.src = 'image/bg_start.png';
        // 平衡杆图片（加载后即用，不纳入 ready 门槛）
        const pole = new Image();
        pole.onload = () => { 
            this.images.pole = pole; 
            // 设置平衡杆基准长度和长度限制
            const poleWidth = pole.naturalWidth || pole.width || 0;
            this.balanceRod.baseLength = poleWidth / 2; // 原图半宽作为基准长度
            this.balanceRod.length = this.balanceRod.baseLength * 0.78; // 初始长度为78%
            this.balanceRod.minLength = this.balanceRod.baseLength * 0.5; // 最小长度为50%
            this.balanceRod.maxLength = this.balanceRod.baseLength * 1.3; // 最大长度为130%
        };
        pole.src = 'image/balance pole.png';
        
        // 加载道具图片
        const bomb = new Image();
        bomb.onload = onLoaded;
        bomb.src = 'image/item_bomb.png';
        
        const fast = new Image();
        fast.onload = onLoaded;
        fast.src = 'image/item_fast.png';
        
        const slow = new Image();
        slow.onload = onLoaded;
        slow.src = 'image/item_slow.png';
        
        const keepBalance = new Image();
        keepBalance.onload = onLoaded;
        keepBalance.src = 'image/item_keep balance.png';
        
        const disruptBalance = new Image();
        disruptBalance.onload = onLoaded;
        disruptBalance.src = 'image/item_disrupt the balance.png';
        
        // 加载背景运动元素图片
        const left_d1 = new Image();
        left_d1.onload = onLoaded;
        left_d1.src = 'image/left_d1.png';
        
        const left_d2 = new Image();
        left_d2.onload = onLoaded;
        left_d2.src = 'image/left_d2.png';
        
        const left_d3 = new Image();
        left_d3.onload = onLoaded;
        left_d3.src = 'image/left_d3.png';
        
        const right_d1 = new Image();
        right_d1.onload = onLoaded;
        right_d1.src = 'image/right_d1.png';
        
        const right_d2 = new Image();
        right_d2.onload = onLoaded;
        right_d2.src = 'image/right_d2.png';
        
        // 云层背景图
        const bg_cloud = new Image();
        bg_cloud.onload = onLoaded;
        bg_cloud.src = 'image/bg_cloud.png';
        
        
        this.images.bg = bg;
        this.images.gs = gs;
        this.images.bg_start = bg_start;
        this.images.powerUps.bomb = bomb;
        this.images.powerUps.fast = fast;
        this.images.powerUps.slow = slow;
        this.images.powerUps.keepBalance = keepBalance;
        this.images.powerUps.disruptBalance = disruptBalance;
        this.images.landscape.left_d1 = left_d1;
        this.images.landscape.left_d2 = left_d2;
        this.images.landscape.left_d3 = left_d3;
        this.images.landscape.right_d1 = right_d1;
        this.images.landscape.right_d2 = right_d2;
        this.images.bg_cloud = bg_cloud;
    }

    loadAudio() {
        const onAudioLoaded = () => {
            this.audio.loaded++;
            console.log('音频加载完成，已加载:', this.audio.loaded);
            if (this.audio.loaded >= 1) { // 1个背景音乐
                this.audio.ready = true;
                console.log('音频系统准备就绪');
                this.checkAllResourcesLoaded(); // 检查所有资源是否加载完成
            }
        };
        
        // 加载背景音乐
        const bgMusic = new Audio();
        bgMusic.oncanplaythrough = () => {
            console.log('背景音乐可以播放');
            onAudioLoaded();
        };
        bgMusic.onerror = (e) => {
            console.warn('背景音乐文件不存在或加载失败，游戏将继续运行', e);
            onAudioLoaded(); // 即使加载失败也继续游戏
        };
        bgMusic.src = 'bg_music.mp3';
        bgMusic.loop = true;
        bgMusic.volume = 0.3; // 设置音量为30%
        bgMusic.preload = 'auto';
        
        console.log('开始加载背景音乐:', bgMusic.src);
        this.audio.bgMusic = bgMusic;
    }

    init() {
        this.setupEventListeners();
        this.gameLoop();
    }

    // 音频控制方法
    playBackgroundMusic() {
        if (this.audio.ready && this.audio.bgMusic) {
            this.audio.bgMusic.play().catch(e => {
                console.warn('背景音乐播放失败:', e);
                // 尝试用户交互后播放
                document.addEventListener('click', () => {
                    this.audio.bgMusic.play().catch(err => console.warn('用户交互后播放失败:', err));
                }, { once: true });
            });
        } else {
            console.log('音频未准备就绪或音频对象不存在');
        }
    }

    pauseBackgroundMusic() {
        if (this.audio.bgMusic) {
            this.audio.bgMusic.pause();
        }
    }

    stopBackgroundMusic() {
        if (this.audio.bgMusic) {
            this.audio.bgMusic.pause();
            this.audio.bgMusic.currentTime = 0;
        }
    }

    setBackgroundMusicVolume(volume) {
        if (this.audio.bgMusic) {
            this.audio.bgMusic.volume = Math.max(0, Math.min(1, volume));
        }
    }

    toggleMute() {
        if (this.audio.bgMusic) {
            if (this.audio.bgMusic.volume > 0) {
                this.audio.bgMusic.volume = 0;
                document.getElementById('volumeSlider').value = 0;
            } else {
                this.audio.bgMusic.volume = 0.3; // 恢复到默认音量
                document.getElementById('volumeSlider').value = 30;
            }
            this.updateMuteButton();
        }
    }

    updateMuteButton() {
        const muteBtn = document.getElementById('muteBtn');
        if (this.audio.bgMusic && this.audio.bgMusic.volume > 0) {
            muteBtn.textContent = '🔊';
        } else {
            muteBtn.textContent = '🔇';
        }
    }

    setupEventListeners() {
        document.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
            if (e.code === 'Space') {
                e.preventDefault(); // 防止页面滚动
                if (!this.gameRunning) {
                this.startGame();
                } else {
                    this.togglePause();
                }
            }
        });

        document.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
        });

        // 开始按钮点击事件
        document.getElementById('startButton').addEventListener('click', () => {
            if (!this.gameRunning) {
                this.startGame();
            }
        });

        // 音频控制事件监听器
        document.getElementById('muteBtn').addEventListener('click', () => {
            this.toggleMute();
        });

        document.getElementById('volumeSlider').addEventListener('input', (e) => {
            const volume = parseInt(e.target.value) / 100;
            this.setBackgroundMusicVolume(volume);
            this.updateMuteButton();
        });
    }

    startGame() {
        this.gameRunning = true;
        this.gamePaused = false;
        this.gameStarted = true;
        document.getElementById('startScreen').style.display = 'none';
        document.getElementById('gameOver').style.display = 'none';
        document.getElementById('pauseScreen').style.display = 'none';
        this.resetGame();
        this.initializeLandscape();
        // 开始播放背景音乐（用户交互后）
        setTimeout(() => {
            this.playBackgroundMusic();
        }, 100);
        this.update();
    }

    togglePause() {
        this.gamePaused = !this.gamePaused;
        if (this.gamePaused) {
            document.getElementById('pauseScreen').style.display = 'block';
        } else {
            document.getElementById('pauseScreen').style.display = 'none';
            this.update();
        }
    }

    restartGame() {
        this.gameRunning = true;
        this.gamePaused = false;
        document.getElementById('startScreen').style.display = 'none';
        document.getElementById('gameOver').style.display = 'none';
        document.getElementById('pauseScreen').style.display = 'none';
        this.resetGame();
        this.initializeLandscape();
        // 重新开始播放背景音乐（用户交互后）
        setTimeout(() => {
            this.playBackgroundMusic();
        }, 100);
        this.update();
    }

    resetGame() {
        this.distance = 0;
        this.score = 0;
        this.player.x = this.balancePivot.x;
        this.player.y = this.balancePivot.y;
        this.player.sway = 0;
        this.player.swaySpeed = 0;
        this.wind.force = 0;
        this.wind.direction = 1;
        this.wind.changeTimer = 0;
        this.background.offset = 0;
        this.landscape = [];
        this.landscapeSpawnTimer = 0;
        this.powerUps = [];
        this.powerUpSpawnTimer = 0;
        this.activePowerUps = [];
        this.balanceRod.length = this.balanceRod.baseLength ? this.balanceRod.baseLength * 0.78 : 60;
        this.updateUI();
    }

    update() {
        if (!this.gameRunning || this.gamePaused) return;
        this.distance += this.speed;
        this.score = Math.floor(this.distance);
        this.updateWind();
        this.updatePlayerBalance();
        this.updatePlayerAnimation();
        this.updateBackground();
        this.updateParticles();
        this.updateLandscape();
        this.updatePowerUps();
        this.updateBalanceRod();
        this.checkGameOver();
        this.updateUI();
    }

    updatePlayerAnimation() {
        // 用前进像素速度驱动帧切换，使动画速度与前进速度一致
        let movePxPerFrame = this.speed * 15; // 基础动画速度
        // 检查所有加速和减速道具，进行叠加计算
        for (let powerUp of this.activePowerUps) {
            if (powerUp.type === 'speed') { 
                movePxPerFrame *= 1.3; 
            } else if (powerUp.type === 'slow') {
                movePxPerFrame *= 0.8;
            }
        }
        this.player.stepAccumPx += movePxPerFrame;
        while (this.player.stepAccumPx >= this.player.stepLengthPx) {
            this.player.stepAccumPx -= this.player.stepLengthPx;
            if (this.sprites && this.sprites.total) {
                this.player.frameIndex = (this.player.frameIndex + 1) % this.sprites.total;
            }
        }
    }

    updateWind() {
        this.wind.changeTimer++;
        if (this.wind.changeTimer >= this.wind.changeInterval) {
            this.wind.direction *= -1;
            // 根据距离调整风力强度：初始较弱，随距离增加而增强
            const baseWindStrength = 0.15; // 基础风力强度（从0.3降低到0.15）
            const distanceMultiplier = Math.min(1 + (this.distance / 1000), 2); // 距离每1000米增加，最多2倍
            this.wind.force = (Math.random() - 0.5) * baseWindStrength * distanceMultiplier;
            this.wind.changeTimer = 0;
            this.wind.changeInterval = 60 + Math.random() * 90; // 增加变化间隔（从30-90改为60-150帧）
        }
        this.wind.force += (Math.random() - 0.5) * 0.01; // 降低风力波动速度（从0.02降低到0.01）
        // 根据距离调整最大风力限制
        const maxWindForce = 0.3 + (this.distance / 2000) * 0.2; // 初始最大0.3，随距离增加到0.5
        this.wind.force = Math.max(-maxWindForce, Math.min(maxWindForce, this.wind.force));
    }

    updatePlayerBalance() {
        let isImmuneToInput = false;
        let isBalanceRestore = false;
        for (let powerUp of this.activePowerUps) {
            if (powerUp.type === 'balance' && powerUp.immuneToInput) {
                isImmuneToInput = true;
                if (powerUp.balanceRestore) {
                    isBalanceRestore = true;
                }
                break;
            }
        }
        if (isBalanceRestore) {
            this.player.sway = 0;
            this.player.swaySpeed = 0;
            return;
        }
        // 降低风力影响倍数，让游戏更容易控制
        let windEffect = this.wind.force * this.wind.direction * 0.3; // 从0.5降低到0.3
        let controlForce = 0;
        if (!isImmuneToInput) {
            if (this.keys['ArrowLeft']) controlForce = -0.075;
            if (this.keys['ArrowRight']) controlForce = 0.075;
        }
        let totalForce = windEffect + controlForce;
        this.player.swaySpeed += totalForce;
        // 增加阻尼系数，让摆幅更容易衰减
        let damping = 0.97; // 从0.95增加到0.97
        for (let powerUp of this.activePowerUps) {
            if (powerUp.type === 'balance') damping = 0.98;
            else if (powerUp.type === 'unbalance') damping = 0.90;
        }
        this.player.swaySpeed *= damping;
        this.player.sway += this.player.swaySpeed;
        this.player.sway = Math.max(-90, Math.min(90, this.player.sway));
        this.player.x = this.balancePivot.x;
        this.player.y = this.balancePivot.y;
    }

    updateBackground() {
        this.background.offset += this.background.speed;
        if (this.background.offset >= this.height) this.background.offset = 0;
    }

    updateParticles() {
        if (Math.random() < 0.3) {
            this.particles.push({
                x: Math.random() * this.width,
                y: this.height + 10,
                vx: (Math.random() - 0.5) * 2,
                vy: -Math.random() * 3 - 1,
                life: 1.0,
                decay: 0.01,
                size: Math.random() * 3 + 1
            });
        }
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const particle = this.particles[i];
            particle.x += particle.vx;
            particle.y += particle.vy;
            particle.life -= particle.decay;
            if (particle.life <= 0 || particle.y < -10) this.particles.splice(i, 1);
        }
    }

    updateLandscape() {
        let baseSpeed = this.speed * 1; // 基础速度等于角色速度
        // 检查所有加速和减速道具，进行叠加计算
        for (let powerUp of this.activePowerUps) {
            if (powerUp.type === 'speed') { 
                baseSpeed *= 1.4; 
            } else if (powerUp.type === 'slow') {
                baseSpeed *= 0.7; // 减速道具对背景运动的影响
            }
        }
        this.landscapeSpeed = baseSpeed;
        // 左边元素生成
        this.leftSpawnTimer++;
        if (this.leftSpawnTimer >= this.leftSpawnInterval) {
            this.spawnLandscapeElement('left');
            this.leftSpawnTimer = 0;
            // 根据角色速度调整生成间隔：速度越快，间隔越短
            const baseInterval = 300 + Math.random() * 360; // 基础间隔5-12秒
            const speedMultiplier = Math.max(0.3, 1 - (this.speed - 0.083) * 2); // 速度越快，倍数越小
            this.leftSpawnInterval = Math.max(50, baseInterval * speedMultiplier); // 最小间隔50帧
        }
        
        // 右边元素生成
        this.rightSpawnTimer++;
        if (this.rightSpawnTimer >= this.rightSpawnInterval) {
            this.spawnLandscapeElement('right');
            this.rightSpawnTimer = 0;
            // 根据角色速度调整生成间隔：速度越快，间隔越短
            const baseInterval = 300 + Math.random() * 360; // 基础间隔5-12秒
            const speedMultiplier = Math.max(0.3, 1 - (this.speed - 0.083) * 2); // 速度越快，倍数越小
            this.rightSpawnInterval = Math.max(50, baseInterval * speedMultiplier); // 最小间隔50帧
        }
        for (let i = this.landscape.length - 1; i >= 0; i--) {
            const element = this.landscape[i];
            const s = this.landscapeSpeed;
            // 曲线移动：基于基础速度，角度从30度到45度再到60度，速度逐渐加速
            const currentTime = Date.now();
            const timeElapsed = (currentTime - element.spawnTime) / 1000; // 出现时间（秒）
            const dir = element.dir || 1; // -1 左下，1 右下
            
            // 角度变化：基于基础速度，前7s是30度方向，后7s过渡到45度，再平滑过渡到60度
            let currentAngle;
            if (timeElapsed <= 7) {
                // 前7秒：保持30度方向
                currentAngle = 30;
            } else if (timeElapsed <= 14) {
                // 7-14秒：从30度过渡到45度
                const angleProgress = (timeElapsed - 7) / 7;
                currentAngle = 30 + (45 - 30) * angleProgress;
            } else {
                // 14秒后：从45度平滑过渡到60度
                const angleProgress = Math.min((timeElapsed - 14) / 14, 1); // 14秒内完成过渡
                currentAngle = 45 + (60 - 45) * angleProgress;
            }
            
            // 速度变化：基于基础速度(speed*1)的倍数变化
            const baseSpeed = this.speed * 1; // 基础速度
            let speedMultiplier;
            if (timeElapsed <= 5) {
                // 0-5秒：从1倍到1.5倍，使用平滑曲线
                const progress = timeElapsed / 5;
                speedMultiplier = 1 + 0.5 * (progress * progress); // 平方曲线
            } else if (timeElapsed <= 10) {
                // 5-10秒：从1.5倍到4倍，使用平滑曲线
                const progress = (timeElapsed - 5) / 5;
                speedMultiplier = 1.5 + 2.5 * (progress * progress); // 平方曲线
            } else if (timeElapsed <= 15) {
                // 10-15秒：从4倍到8倍，使用平滑曲线
                const progress = (timeElapsed - 10) / 5;
                speedMultiplier = 4 + 4 * (progress * progress); // 平方曲线
            } else {
                // 15秒后：从8倍到10倍，使用平滑曲线
                const progress = Math.min((timeElapsed - 15) / 5, 1); // 限制在5秒内完成
                speedMultiplier = 8 + 2 * (progress * progress); // 平方曲线
            }
            speedMultiplier = Math.min(speedMultiplier, 10); // 最大10倍
            const currentSpeed = baseSpeed * speedMultiplier;
            
            // 根据当前角度计算移动分量
            const angleRad = currentAngle * Math.PI / 180;
            const moveX = currentSpeed * Math.sin(angleRad) * dir; // 水平移动分量
            const moveY = currentSpeed * Math.cos(angleRad); // 垂直移动分量
            
            element.x += moveX;
            element.y += moveY;
            
            // 缩放逻辑：基于基础速度，与速度变化同步
            const baseScale = 0.1125; // 初始缩放
            let targetScale;
            if (timeElapsed <= 7) {
                // 前7秒：从初始缩放到0.5倍（与30度角度对应）
                const scaleProgress = timeElapsed / 7;
                targetScale = baseScale + (0.5 - baseScale) * scaleProgress;
            } else if (timeElapsed <= 14) {
                // 7-14秒：从0.5倍到1.0倍（与45度角度对应）
                const scaleProgress = (timeElapsed - 7) / 7;
                targetScale = 0.5 + (1.0 - 0.5) * scaleProgress;
            } else {
                // 14秒后：从1.0倍到2.2倍（与60度角度对应）
                const scaleProgress = Math.min((timeElapsed - 14) / 14, 1);
                targetScale = 1.0 + (2.2 - 1.0) * scaleProgress;
            }
            element.scale = Math.min(targetScale, 2.2); // 最大缩放到2.2倍
            
            if (element.y > this.height + 200 || element.x < -200 || element.x > this.width + 200) this.landscape.splice(i, 1);
        }
    }


    updatePowerUps() {
        this.powerUpSpawnTimer++;
        if (this.powerUpSpawnTimer >= this.powerUpSpawnInterval) {
            this.spawnPowerUp();
            this.powerUpSpawnTimer = 0;
            this.powerUpSpawnInterval = 60 + Math.random() * 60;
        }
        for (let i = this.powerUps.length - 1; i >= 0; i--) {
            const powerUp = this.powerUps[i];
            powerUp.y += 7;
            if (this.checkPowerUpCollision(powerUp)) {
                this.collectPowerUp(powerUp);
                this.powerUps.splice(i, 1);
            } else if (powerUp.y > this.height + 100) {
                this.powerUps.splice(i, 1);
            }
        }
        for (let i = this.activePowerUps.length - 1; i >= 0; i--) {
            const powerUp = this.activePowerUps[i];
            powerUp.duration--;
            if (powerUp.duration <= 0) {
                this.deactivatePowerUp(powerUp);
                this.activePowerUps.splice(i, 1);
            }
        }
    }

    updateBalanceRod() {
        if (this.keys['KeyZ'] || this.keys['KeyX']) {
            if (this.keys['KeyZ']) {
                this.balanceRod.length = Math.min(this.balanceRod.maxLength, this.balanceRod.length + this.balanceRod.extendSpeed);
            }
            if (this.keys['KeyX']) {
                this.balanceRod.length = Math.max(this.balanceRod.minLength, this.balanceRod.length - this.balanceRod.extendSpeed);
            }
        }
    }

    spawnLandscapeElement(side = null) {
        const centerX = this.width / 2;
        const centerY = this.height / 2;
        
        // 根据参数或随机选择运动方向：-1为左下，1为右下
        const direction = side === 'left' ? -1 : (side === 'right' ? 1 : (Math.random() < 0.5 ? -1 : 1));
        
        // 根据方向选择对应的图片类型
        let imageType;
        if (direction === -1) {
            // 左下角运动，选择left_d1、left_d2、left_d3
            const leftTypes = ['left_d1', 'left_d2', 'left_d3'];
            imageType = leftTypes[Math.floor(Math.random() * leftTypes.length)];
        } else {
            // 右下角运动，选择right_d1、right_d2
            const rightTypes = ['right_d1', 'right_d2'];
            imageType = rightTypes[Math.floor(Math.random() * rightTypes.length)];
        }
        
        // 生成位置：中心点左右35-70像素，中心高度及往下10像素区间内
        let positionOffset;
        let yOffset;
        let attempts = 0;
        const maxAttempts = 10;
        
        do {
            positionOffset = direction === -1 ? 
                -(35 + Math.random() * 35) : // 左边：中心点偏左35-70像素
                (35 + Math.random() * 35);   // 右边：中心点偏右35-70像素
            
            // Y坐标：中心高度及往下10像素区间内
            yOffset = Math.random() * 10; // 0-10像素向下偏移
            
            // 检查是否与现有元素重叠
            const newX = centerX + positionOffset;
            const newY = centerY + yOffset;
            const minDistance = 80; // 最小距离80像素
            let tooClose = false;
            
            for (const element of this.landscape) {
                const distance = Math.sqrt((newX - element.x) ** 2 + (newY - element.y) ** 2);
                if (distance < minDistance) {
                    tooClose = true;
                    break;
                }
            }
            
            if (!tooClose) break;
            attempts++;
        } while (attempts < maxAttempts);
        
        // 生成大小：初始大小的0.8倍到1.2倍
        const baseScale = 0.1125; // 基础缩放
        const scaleMultiplier = 0.8 + Math.random() * 0.4; // 0.8-1.2倍
        const finalScale = baseScale * scaleMultiplier;
        
        this.landscape.push({
            x: centerX + positionOffset,
            y: centerY + yOffset,
            type: imageType,
            side: direction === -1 ? 'left' : 'right',
            dir: direction,
            scale: finalScale, // 随机缩放：0.8-1.2倍
            size: 60 + Math.random() * 120, // 保留size属性用于兼容性
            spawnTime: Date.now() // 记录生成时间
        });
    }


    spawnPowerUp() {
        const types = ['speed', 'balance', 'slow', 'unbalance', 'speed', 'balance', 'slow', 'unbalance', 'explosion'];
        const type = types[Math.floor(Math.random() * types.length)];
        const tightropeX = this.balancePivot.x;
        const minDistance = this.balanceRod.minLength + 50; // 平衡杆最短+30像素
        const maxDistance = this.balanceRod.maxLength; // 平衡杆最长
        const side = Math.random() < 0.5 ? -1 : 1;
        const distance = minDistance + Math.random() * (maxDistance - minDistance);
        const x = tightropeX + (side * distance);
        this.powerUps.push({ x, y: -50, type, size: 20, collected: false });
    }

    checkPowerUpCollision(powerUp) {
        const playerX = this.balancePivot.x + 7; // 平衡杆向右偏移7像素
        const playerY = this.balancePivot.y + 2 - 265; // 平衡杆向下偏移2像素，位置-265
        const rodLength = this.balanceRod.length;
        
        // 检测道具是否与平衡杆碰撞（考虑平衡杆的旋转角度）
        const dx = powerUp.x - playerX;
        const dy = powerUp.y - playerY;
        const swayRad = this.player.sway * Math.PI / 180;
        
        // 将道具坐标转换到平衡杆的局部坐标系
        const localX = dx * Math.cos(-swayRad) - dy * Math.sin(-swayRad);
        const localY = dx * Math.sin(-swayRad) + dy * Math.cos(-swayRad);
        
        // 添加调试信息：检查道具是否在合理范围内
        // 如果道具距离平衡杆中心太远，直接返回false
        const distanceFromCenter = Math.sqrt(localX * localX + localY * localY);
        const maxReasonableDistance = rodLength + 100; // 最大合理距离
        
        if (distanceFromCenter > maxReasonableDistance) {
            return false;
        }
        
        // 调试信息：记录碰撞检测的详细信息
        if (Math.abs(this.player.sway) > 10) { // 只在倾斜时记录调试信息
            console.log(`倾斜角度: ${this.player.sway.toFixed(1)}°, 道具位置: (${localX.toFixed(1)}, ${localY.toFixed(1)}), 距离: ${distanceFromCenter.toFixed(1)}`);
        }
        
        // 获取道具图片尺寸，用于更精确的碰撞检测
        let powerUpWidth = 20; // 默认道具宽度
        let powerUpHeight = 20; // 默认道具高度
        
        // 根据道具类型获取实际图片尺寸
        if (powerUp.type === 'explosion' && this.images.powerUps.bomb) {
            powerUpWidth = this.images.powerUps.bomb.naturalWidth || 20;
            powerUpHeight = this.images.powerUps.bomb.naturalHeight || 20;
        } else if (powerUp.type === 'speed' && this.images.powerUps.fast) {
            powerUpWidth = this.images.powerUps.fast.naturalWidth || 20;
            powerUpHeight = this.images.powerUps.fast.naturalHeight || 20;
        } else if (powerUp.type === 'slow' && this.images.powerUps.slow) {
            powerUpWidth = this.images.powerUps.slow.naturalWidth || 20;
            powerUpHeight = this.images.powerUps.slow.naturalHeight || 20;
        } else if (powerUp.type === 'balance' && this.images.powerUps.keepBalance) {
            powerUpWidth = this.images.powerUps.keepBalance.naturalWidth || 20;
            powerUpHeight = this.images.powerUps.keepBalance.naturalHeight || 20;
        } else if (powerUp.type === 'unbalance' && this.images.powerUps.disruptBalance) {
            powerUpWidth = this.images.powerUps.disruptBalance.naturalWidth || 20;
            powerUpHeight = this.images.powerUps.disruptBalance.naturalHeight || 20;
        }
        
        // 精确的倾斜平衡杆碰撞检测
        const rodWidth = 30; // 平衡杆宽度
        const collisionMargin = 3; // 碰撞边距
        
        // 首先进行简单的范围检查，避免不必要的复杂计算
        // 检查道具是否在平衡杆的X轴范围内
        if (Math.abs(localX) > rodLength + 50) { // 50像素的缓冲区域
            return false;
        }
        
        // 检查道具是否在平衡杆的Y轴范围内
        if (Math.abs(localY) > rodWidth/2 + 50) { // 50像素的缓冲区域
            return false;
        }
        
        // 计算平衡杆在局部坐标系中的四个角点
        const rodHalfLength = rodLength + collisionMargin;
        const rodHalfWidth = rodWidth/2 + collisionMargin;
        
        // 平衡杆的四个角点（在局部坐标系中）
        const rodCorners = [
            { x: -rodHalfLength, y: -rodHalfWidth }, // 左端上
            { x: rodHalfLength, y: -rodHalfWidth },  // 右端上
            { x: rodHalfLength, y: rodHalfWidth },   // 右端下
            { x: -rodHalfLength, y: rodHalfWidth }   // 左端下
        ];
        
        // 计算道具在局部坐标系中的四个角点
        const powerUpHalfWidth = powerUpWidth/2;
        const powerUpHalfHeight = powerUpHeight/2;
        
        const powerUpCorners = [
            { x: localX - powerUpHalfWidth, y: localY - powerUpHalfHeight }, // 左上
            { x: localX + powerUpHalfWidth, y: localY - powerUpHalfHeight }, // 右上
            { x: localX + powerUpHalfWidth, y: localY + powerUpHalfHeight }, // 右下
            { x: localX - powerUpHalfWidth, y: localY + powerUpHalfHeight }  // 左下
        ];
        
        // 使用分离轴定理进行精确的矩形碰撞检测
        // 检查平衡杆的边是否与道具分离
        for (let i = 0; i < 4; i++) {
            const p1 = rodCorners[i];
            const p2 = rodCorners[(i + 1) % 4];
            
            // 计算边的法向量
            const edgeX = p2.x - p1.x;
            const edgeY = p2.y - p1.y;
            const length = Math.sqrt(edgeX * edgeX + edgeY * edgeY);
            const normalX = -edgeY / length;
            const normalY = edgeX / length;
            
            // 投影平衡杆到法向量上
            let rodMin = Infinity, rodMax = -Infinity;
            for (const corner of rodCorners) {
                const projection = corner.x * normalX + corner.y * normalY;
                rodMin = Math.min(rodMin, projection);
                rodMax = Math.max(rodMax, projection);
            }
            
            // 投影道具到法向量上
            let powerUpMin = Infinity, powerUpMax = -Infinity;
            for (const corner of powerUpCorners) {
                const projection = corner.x * normalX + corner.y * normalY;
                powerUpMin = Math.min(powerUpMin, projection);
                powerUpMax = Math.max(powerUpMax, projection);
            }
            
            // 如果投影不重叠，则没有碰撞
            if (rodMax < powerUpMin || powerUpMax < rodMin) {
                return false;
            }
        }
        
        // 检查道具的边是否与平衡杆分离
        for (let i = 0; i < 4; i++) {
            const p1 = powerUpCorners[i];
            const p2 = powerUpCorners[(i + 1) % 4];
            
            // 计算边的法向量
            const edgeX = p2.x - p1.x;
            const edgeY = p2.y - p1.y;
            const length = Math.sqrt(edgeX * edgeX + edgeY * edgeY);
            const normalX = -edgeY / length;
            const normalY = edgeX / length;
            
            // 投影平衡杆到法向量上
            let rodMin = Infinity, rodMax = -Infinity;
            for (const corner of rodCorners) {
                const projection = corner.x * normalX + corner.y * normalY;
                rodMin = Math.min(rodMin, projection);
                rodMax = Math.max(rodMax, projection);
            }
            
            // 投影道具到法向量上
            let powerUpMin = Infinity, powerUpMax = -Infinity;
            for (const corner of powerUpCorners) {
                const projection = corner.x * normalX + corner.y * normalY;
                powerUpMin = Math.min(powerUpMin, projection);
                powerUpMax = Math.max(powerUpMax, projection);
            }
            
            // 如果投影不重叠，则没有碰撞
            if (rodMax < powerUpMin || powerUpMax < rodMin) {
                return false;
            }
        }
        
        // 所有轴上的投影都重叠，说明有碰撞
        return true;
    }

    collectPowerUp(powerUp) {
        this.playSound(powerUp.type);
        this.showPowerUpEffect(powerUp);
        if (this.hasActivePowerUp('balance') && (powerUp.type === 'unbalance' || powerUp.type === 'slow')) {
            this.clearBalanceEffect();
        }
        const activePowerUp = { type: powerUp.type, duration: powerUp.type === 'balance' ? 180 : 300, originalValue: null };
        if (powerUp.type === 'explosion') {
            this.gameOver();
            return;
        } else if (powerUp.type === 'speed') {
            this.speed += 0.05; // 直接增加速度，支持叠加
        } else if (powerUp.type === 'balance') {
            this.player.sway = 0; this.player.swaySpeed = 0;
            if (!this.hasActivePowerUp('balance')) {
                activePowerUp.originalValue = 0.95; activePowerUp.immuneToInput = true; activePowerUp.balanceRestore = true;
            } else {
                const existingBalance = this.activePowerUps.find(p => p.type === 'balance');
                existingBalance.duration = 180;
            }
        } else if (powerUp.type === 'slow') {
            this.speed -= 0.03; // 直接减少速度，支持叠加
        } else if (powerUp.type === 'unbalance') {
            const unbalanceOffset = powerUp.x > this.tightrope.x ? 15 : -15;
            this.player.sway += unbalanceOffset;
            if (this.hasActivePowerUp('unbalance')) { const existingUnbalance = this.activePowerUps.find(p => p.type === 'unbalance'); existingUnbalance.duration = 300; return; }
        }
        if (!this.hasActivePowerUp(powerUp.type)) { this.activePowerUps.push(activePowerUp); }
    }

    hasActivePowerUp(type) { return this.activePowerUps.some(powerUp => powerUp.type === type); }

    clearBalanceEffect() {
        const balanceIndex = this.activePowerUps.findIndex(powerUp => powerUp.type === 'balance');
        if (balanceIndex !== -1) this.activePowerUps.splice(balanceIndex, 1);
        this.player.damping = 0.95;
    }

    clearAllPowerUpEffects() {
        // 计算所有道具对速度的影响并清除
        let speedChange = 0;
        for (let powerUp of this.activePowerUps) {
            if (powerUp.type === 'speed') speedChange += 0.05;
            else if (powerUp.type === 'slow') speedChange -= 0.03;
        }
        this.speed -= speedChange;
        this.activePowerUps = [];
    }

    deactivatePowerUp(powerUp) {
        // 单个道具失效时直接减去对应的影响
        if (powerUp.type === 'speed') this.speed -= 0.05;
        else if (powerUp.type === 'slow') this.speed += 0.03;
    }

    playSound(type) {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            oscillator.connect(gainNode); gainNode.connect(audioContext.destination);
            if (type === 'speed' || type === 'balance') {
                oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
                gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
            } else if (type === 'explosion') {
                oscillator.frequency.setValueAtTime(200, audioContext.currentTime);
                gainNode.gain.setValueAtTime(0.5, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
            } else {
                oscillator.frequency.setValueAtTime(400, audioContext.currentTime);
                gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
            }
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.5);
        } catch (e) {}
    }

    showPowerUpEffect(powerUp) {
        const effectText = document.createElement('div');
        effectText.style.position = 'absolute';
        effectText.style.left = '50%';
        effectText.style.top = '60%';
        effectText.style.transform = 'translateX(-50%)';
        effectText.style.color = this.getPowerUpColor(powerUp.type);
        effectText.style.fontSize = '40px';
        effectText.style.fontWeight = 'bold';
        effectText.style.pointerEvents = 'none';
        effectText.style.zIndex = '1000';
        effectText.style.textAlign = 'center';
        effectText.style.textShadow = '2px 2px 4px rgba(0,0,0,0.8)';
        effectText.textContent = this.getPowerUpText(powerUp.type);
        document.body.appendChild(effectText);
        let opacity = 1; let y = 60;
        const animate = () => {
            opacity -= 0.015; y -= 0.5; effectText.style.opacity = opacity; effectText.style.top = y + '%';
            if (opacity > 0) requestAnimationFrame(animate); else document.body.removeChild(effectText);
        };
        animate();
    }

    getPowerUpColor(type) {
        const colors = { 
            'speed': '#FFD700',     // 速度提升 - 金色
            'balance': '#FFD700',   // 平衡增强 - 金色
            'explosion': '#000000', // 爆炸 - 黑色
            'rock': '#000000',      // 岩石 - 黑色
            'slow': '#000000',      // 减速 - 黑色
            'unbalance': '#000000'  // 平衡破坏 - 黑色
        };
        return colors[type] || '#FFFFFF';
    }

    getPowerUpText(type) {
        const texts = { 'explosion': '爆炸!', 'speed': '速度提升!', 'balance': '平衡增强!', 'slow': '减速!', 'unbalance': '平衡破坏!' };
        return texts[type] || '未知道具';
    }

    initializeLandscape() {
        // 初始也从中心生成若干个元素
        for (let i = 0; i < 6; i++) {
            this.spawnLandscapeElement();
        }
    }


    checkGameOver() {
        if (Math.abs(this.player.sway) >= 60) this.gameOver();
    }

    gameOver() {
        this.gameRunning = false;
        const finalScore = Math.floor(this.distance);
        document.getElementById('finalDistance').textContent = finalScore;
        
        // 检查是否超过最远距离
        const isNewRecord = finalScore > this.highScore;
        const previousHighScore = this.highScore; // 保存之前的最高分
        
        // 更新最高分
        if (isNewRecord) {
            this.highScore = finalScore;
            localStorage.setItem('tightropeHighScore', this.highScore);
            // 播放新纪录音效
            this.playNewRecordSound();
        } else {
            // 播放游戏结束音效
            this.playGameOverSound();
        }
        
        // 根据是否创造新纪录显示不同信息
        const titleElement = document.getElementById('gameOverTitle');
        const messageElement = document.getElementById('gameOverMessage');
        
        if (isNewRecord) {
            titleElement.textContent = '新纪录！';
            titleElement.classList.add('new-record');
            messageElement.innerHTML = `
                <div class="current-distance-box">
                    <span class="current-distance-text" style="font-size: 1.2em;">你走了 </span><span id="finalDistance">${finalScore}</span><span class="current-distance-unit" style="font-size: 1.2em;"> m</span>
                </div>
                <div class="previous-distance-info">
                    曾经距离 <span id="bestDistanceDisplay">${previousHighScore}</span> m
                </div>
            `;
        } else {
            titleElement.textContent = '就差一点点！';
            titleElement.classList.remove('new-record');
            messageElement.innerHTML = `
                <div class="current-distance-box">
                    <span class="current-distance-text" style="font-size: 1.2em;">你走了 </span><span id="finalDistance">${finalScore}</span><span class="current-distance-unit" style="font-size: 1.2em;"> m</span>
                </div>
                <div class="previous-distance-info">
                    最远距离 <span id="bestDistanceDisplay">${this.highScore}</span> m
                </div>
            `;
        }
        
        document.getElementById('gameOver').style.display = 'block';
        // 停止背景音乐
        this.stopBackgroundMusic();
    }

    updateUI() {
        const currentDistance = Math.floor(this.distance);
        const maxDistance = 6666;
        const progressPercentage = Math.min((currentDistance / maxDistance) * 100, 100);
        const bestDistancePercentage = Math.min((this.highScore / maxDistance) * 100, 100);
        
        // 更新进度条
        document.getElementById('progressFill').style.width = progressPercentage + '%';
        document.getElementById('currentDistanceNumber').textContent = currentDistance;
        
        // 更新最佳距离竖线和标签
        const displayPercentage = Math.max(2, bestDistancePercentage); // 最小显示位置为2%
        document.getElementById('bestDistanceLine').style.left = displayPercentage + '%';
        document.getElementById('bestDistanceLabel').style.left = displayPercentage + '%';
        document.getElementById('bestDistanceLabel').textContent = this.highScore + 'm';
    }

    render() {
        this.ctx.clearRect(0, 0, this.width, this.height);
        this.drawBackground();
        this.drawPlayer();
        this.drawWindIndicator();
        this.drawParticles();
        this.drawPowerUps();
    }

    drawBackground() {
        // 画布内完全移除渐变；只绘制素材图层：先 bg（清晰），再 gs
        this.ctx.clearRect(0, 0, this.width, this.height);
        if (this.images && this.images.bg) {
            this.ctx.drawImage(this.images.bg, 0, 0, this.width, this.height);
        }
        if (this.images && this.images.gs) {
            this.ctx.drawImage(this.images.gs, 0, 0, this.width, this.height);
        }
        this.drawScrollingLandscape();
        this.drawCloudBackground();
    }


    drawScrollingLandscape() {
        // 从后往前绘制，让后出现的元素在下方
        for (let i = this.landscape.length - 1; i >= 0; i--) {
            this.drawLandscapeElement(this.landscape[i]);
        }
    }

    drawCloudBackground() {
        // 绘制云层背景，位于活动背景之上，平衡杆之下
        if (this.images && this.images.bg_cloud) {
            this.ctx.drawImage(this.images.bg_cloud, 0, 0, this.width, this.height);
        }
    }


    drawLandscapeElement(element) {
        const x = element.x;
        const y = element.y;
        
        // 根据元素类型选择对应的图片
        let img = null;
        if (element.type === 'left_d1' && this.images.landscape.left_d1) {
            img = this.images.landscape.left_d1;
        } else if (element.type === 'left_d2' && this.images.landscape.left_d2) {
            img = this.images.landscape.left_d2;
        } else if (element.type === 'left_d3' && this.images.landscape.left_d3) {
            img = this.images.landscape.left_d3;
        } else if (element.type === 'right_d1' && this.images.landscape.right_d1) {
            img = this.images.landscape.right_d1;
        } else if (element.type === 'right_d2' && this.images.landscape.right_d2) {
            img = this.images.landscape.right_d2;
        }
        
        // 如果图片加载完成，使用图片绘制
        if (img) {
            const imgWidth = img.naturalWidth || img.width || 0;
            const imgHeight = img.naturalHeight || img.height || 0;
            const scale = element.scale || 0.05;
            const scaledWidth = imgWidth * scale;
            const scaledHeight = imgHeight * scale;
            // 以元素中心为基准绘制图片，应用缩放
            this.ctx.drawImage(img, x - scaledWidth / 2, y - scaledHeight / 2, scaledWidth, scaledHeight);
        } else {
            // 备用：如果图片未加载，使用简单的圆形绘制
            const scale = element.scale || 0.05;
            const size = 30 * scale;
            this.ctx.fillStyle = '#90EE90';
                this.ctx.beginPath();
            this.ctx.arc(x, y, size, 0, Math.PI * 2);
                this.ctx.fill();
        }
    }

    drawTightrope() {
        this.ctx.strokeStyle = '#8B4513';
        this.ctx.lineWidth = this.tightrope.thickness;
        this.ctx.beginPath(); this.ctx.moveTo(this.tightrope.x, 0); this.ctx.lineTo(this.tightrope.x, this.height); this.ctx.stroke();
    }

    drawPlayer() {
        // 1) 平衡杆：围绕 balancePivot 旋转；以原图尺寸为基准，通过缩放控制长度
        if (this.images && this.images.pole) {
            const img = this.images.pole;
            const iw = img.naturalWidth || img.width || 0;
            const ih = img.naturalHeight || img.height || 0;
            const baseHalfLen = iw / 2; // 原图半宽
            const scaleX = baseHalfLen > 0 ? (this.balanceRod.length / baseHalfLen) : 1; // 根据当前长度计算缩放比例
            this.ctx.save();
            this.ctx.translate(this.balancePivot.x + 7, this.balancePivot.y + 2); // 向右偏移7像素，向下偏移2像素
            this.ctx.rotate(this.player.sway * Math.PI / 180);
            this.ctx.scale(scaleX, 1); // 水平缩放
            this.ctx.drawImage(img, -baseHalfLen, -ih / 2 - 265, iw, ih); // 绘制原图尺寸，位置-265
            this.ctx.restore();
        }

        // 2) 人物帧图：围绕 balancePivot 旋转，底边对齐画布底边，不缩放
        if (this.sprites && this.sprites.ready) {
            const img = this.sprites.manFrames[this.player.frameIndex] || this.sprites.manFrames[0];
            const iw = img.naturalWidth || img.width || 0;
            const ih = img.naturalHeight || img.height || 0;
            this.ctx.save();
            this.ctx.translate(this.balancePivot.x, this.balancePivot.y);
            this.ctx.rotate(this.player.sway * Math.PI / 180);
            // 计算人物帧图在画布底边的位置，以balancePivot为旋转中心
            const drawY = this.height - this.balancePivot.y - ih;
            this.ctx.drawImage(img, -iw / 2, drawY, iw, ih);
            this.ctx.restore();
        } else {
            const iw = 40; const ih = 80;
            this.ctx.save();
            this.ctx.translate(this.balancePivot.x, this.balancePivot.y);
            this.ctx.rotate(this.player.sway * Math.PI / 180);
            // 计算人物帧图在画布底边的位置，以balancePivot为旋转中心
            const drawY = this.height - this.balancePivot.y - ih;
            this.ctx.fillStyle = '#FF6B6B';
            this.ctx.fillRect(-iw / 2, drawY, iw, ih);
            this.ctx.restore();
        }

        // 更新玩家位置到枢轴
        this.player.x = this.balancePivot.x; this.player.y = this.balancePivot.y;
    }

    drawWindIndicator() {
        const x = this.width / 2 + 5; // 风力表盘中心X坐标
        const y = this.height - 250; // 风力表盘中心Y坐标
        const windForce = this.wind.force * this.wind.direction;
        
        // 风力等级（左右各1-3级）
        const windLevel = Math.min(3, Math.max(1, Math.floor(Math.abs(windForce) * 6) + 1));
        const radius = 60; // 圆弧半径
        
        // 绘制上半圆弧 - 从正中向两边偏移，左右各1-3级
        const centerAngle = -Math.PI / 2; // 中心角度（正上方）
        const maxAngle = Math.PI * 0.3; // 左右各54度范围（3级对应）
        
        this.ctx.strokeStyle = '#FFF';
        this.ctx.lineWidth = 4;
        this.ctx.beginPath();
        this.ctx.arc(x, y, radius, centerAngle - maxAngle, centerAngle + maxAngle);
        this.ctx.stroke();
        
        // 绘制刻度线 - 左右各1/2/3级
        this.ctx.strokeStyle = '#FFF';
        this.ctx.lineWidth = 3;
        
        const scaleLevels = [1, 2, 3]; // 等级刻度
        
        // 左侧刻度（东风）
        scaleLevels.forEach(level => {
            const angle = centerAngle - (level / 3) * maxAngle; // 从中心向左偏移
            const x1 = x + Math.cos(angle) * (radius + 7);
            const y1 = y + Math.sin(angle) * (radius + 7);
            const x2 = x + Math.cos(angle) * (radius + 18);
            const y2 = y + Math.sin(angle) * (radius + 18);
            
            this.ctx.beginPath();
            this.ctx.moveTo(x1, y1);
            this.ctx.lineTo(x2, y2);
            this.ctx.stroke();
        });
        
        // 右侧刻度（西风）
        scaleLevels.forEach(level => {
            const angle = centerAngle + (level / 3) * maxAngle; // 从中心向右偏移
            const x1 = x + Math.cos(angle) * (radius + 7);
            const y1 = y + Math.sin(angle) * (radius + 7);
            const x2 = x + Math.cos(angle) * (radius + 18);
            const y2 = y + Math.sin(angle) * (radius + 18);
            
            this.ctx.beginPath();
            this.ctx.moveTo(x1, y1);
            this.ctx.lineTo(x2, y2);
            this.ctx.stroke();
        });
        
        // 绘制等级数字 - 标在圆弧外
        this.ctx.fillStyle = '#FFF';
        this.ctx.font = 'bold 18px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        
        // 左侧数字（东风）
        scaleLevels.forEach(level => {
            const angle = centerAngle - (level / 3) * maxAngle;
            const textX = x + Math.cos(angle) * (radius + 30);
            const textY = y + Math.sin(angle) * (radius + 30);
            this.ctx.fillText(level.toString(), textX, textY);
        });
        
        // 右侧数字（西风）
        scaleLevels.forEach(level => {
            const angle = centerAngle + (level / 3) * maxAngle;
            const textX = x + Math.cos(angle) * (radius + 30);
            const textY = y + Math.sin(angle) * (radius + 30);
            this.ctx.fillText(level.toString(), textX, textY);
        });
        
        // 绘制指针 - 根据风力方向，从正中向两边偏移
        let pointerAngle;
        if (windForce < 0) { // 东风（负值）
            const clampedWind = Math.max(0, Math.min(3, windLevel));
            pointerAngle = centerAngle - (clampedWind / 3) * maxAngle; // 从中心向左偏移
        } else if (windForce > 0) { // 西风（正值）
            const clampedWind = Math.max(0, Math.min(3, windLevel));
            pointerAngle = centerAngle + (clampedWind / 3) * maxAngle; // 从中心向右偏移
        } else {
            pointerAngle = centerAngle; // 正中（无风）
        }
        
        const pointerLength = radius - 12;
        
        // 根据风力等级选择指针颜色
        let pointerColor = '#FFF';
        if (windLevel <= 1) {
            pointerColor = '#0F0'; // 绿色
        } else if (windLevel <= 2) {
            pointerColor = '#FF0'; // 黄色
        } else {
            pointerColor = '#F00'; // 红色
        }
        
        this.ctx.strokeStyle = pointerColor;
        this.ctx.lineWidth = 6;
        this.ctx.beginPath();
        this.ctx.moveTo(x, y);
        this.ctx.lineTo(
            x + Math.cos(pointerAngle) * pointerLength,
            y + Math.sin(pointerAngle) * pointerLength
        );
        this.ctx.stroke();
        
        // 绘制指针中心点
        this.ctx.fillStyle = '#FFF';
        this.ctx.beginPath();
        this.ctx.arc(x, y, 6, 0, Math.PI * 2);
        this.ctx.fill();
        
        // 显示当前风力等级和方向
        const windDirection = windForce < 0 ? '东风' : windForce > 0 ? '西风' : '无风';
        this.ctx.fillStyle = '#FFF';
        this.ctx.font = 'bold 18px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(`${windDirection} 等级: ${windLevel}`, x, y + 52);
    }


    drawParticles() {
        this.particles.forEach(particle => {
            this.ctx.save(); this.ctx.globalAlpha = particle.life; this.ctx.fillStyle = '#FFD700'; this.ctx.beginPath(); this.ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2); this.ctx.fill(); this.ctx.restore();
        });
    }

    drawPowerUps() { this.powerUps.forEach(powerUp => { this.drawPowerUp(powerUp); }); }

    drawPowerUp(powerUp) {
        const x = powerUp.x;
        const y = powerUp.y;
        
        // 根据道具类型选择对应的图片
        let img = null;
        if (powerUp.type === 'explosion' && this.images.powerUps.bomb) {
            img = this.images.powerUps.bomb;
        } else if (powerUp.type === 'speed' && this.images.powerUps.fast) {
            img = this.images.powerUps.fast;
        } else if (powerUp.type === 'slow' && this.images.powerUps.slow) {
            img = this.images.powerUps.slow;
        } else if (powerUp.type === 'balance' && this.images.powerUps.keepBalance) {
            img = this.images.powerUps.keepBalance;
        } else if (powerUp.type === 'unbalance' && this.images.powerUps.disruptBalance) {
            img = this.images.powerUps.disruptBalance;
        }
        
        // 如果图片加载完成，使用图片绘制
        if (img) {
            const imgWidth = img.naturalWidth || img.width || 0;
            const imgHeight = img.naturalHeight || img.height || 0;
            // 以道具中心为基准绘制图片，保持原始大小
            this.ctx.drawImage(img, x - imgWidth / 2, y - imgHeight / 2, imgWidth, imgHeight);
        } else {
            // 备用：如果图片未加载，使用简单的圆形绘制
            this.ctx.fillStyle = '#FFB6C1';
            this.ctx.beginPath();
            this.ctx.arc(x, y, 20, 0, Math.PI * 2);
            this.ctx.fill();
        }
    }

    gameLoop() {
        this.update();
        this.render();
        requestAnimationFrame(() => this.gameLoop());
    }
}

window.addEventListener('load', () => {
    new TightropeGame();
});



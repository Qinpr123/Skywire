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
        this.speed = 0.1; // 提升初始速度（从0.083提升到0.1）
        this.score = 0;
        this.gameFrameCount = 0; // 游戏帧计数器（只在游戏运行时增加，用于landscape时间计算）
        // 垂死挣扎机制（倾斜边界）
        this.dangerZoneTimer = 0; // 进入危险区域的时间（帧数）
        this.dangerZoneDuration = 180; // 垂死挣扎时间：3秒（60fps * 3）
        this.dangerThreshold = 60; // 危险阈值：60度
        this.deathThreshold = 75; // 死亡阈值：75度（冗余范围15度）
        // 炸弹绝处逢生机制（无保护罩，仅一次逃生机会）
        this.bombRescue = {
            active: false,   // 是否处于救援阶段
            timer: 0,        // 已经过的帧数
            duration: 108,   // 救援持续时间：1.8秒（60fps * 1.8）
            resolved: false,  // 是否已经处理（成功或失败）
            contactAngle: 0,  // 接触炸弹时的角度
            rescueKey: 'KeyQ' // 当前救援按键（从 Q/W/E/A/S/D 中随机）
        };
        // 绝处逢生成功后的护罩动画状态（与金色文字同步淡出）
        this.bombRescueShield = {
            active: false,
            timer: 0,
            duration: 60 // 约1秒
        };
        // 多用户存档系统
        this.currentUser = null;
        this.users = this.loadUsers();
        this.highScore = 0;
        this.gameStarted = false;
        this.editMode = false; // 编辑模式状态

        // 新手教学关卡系统
        this.tutorialMode = false; // 是否处于新手教学模式
        this.currentTutorialLevel = 0; // 当前关卡（0表示未开始）
        const tutorialProgress = this.loadTutorialProgress(); // 加载关卡进度
        this.tutorialUnlockedLevels = tutorialProgress.unlocked || tutorialProgress; // 兼容旧格式
        this.tutorialLevelDistances = tutorialProgress.distances || {}; // 每个关卡的最远距离
        this.tutorialLevelCompletedStatus = tutorialProgress.completed || {}; // 每个关卡的通关状态（对象）
        this.tutorialLevelCompleted = false; // 当前关卡是否已完成检查（布尔值，用于避免重复触发）
        this.tutorialPassedDistance = 0; // 当前关卡已通过的距离
        this.tutorialTargetDistance = 200; // 通关目标距离（关卡1为200m，关卡2为400m）
        // 关卡2的时间限制系统（必须在规定时间内完成400m）
        // 基础速度0.1，无道具情况下走400m需要4000帧（约66.67秒）
        // 设置时间限制为3000帧（50秒），迫使玩家必须吃加速道具
        this.tutorialLevel2TimeLimit = 3000; // 时间限制（帧数，50秒）
        this.tutorialLevel2TimeElapsed = 0; // 已用时间（帧数）
        this.tutorialLevel2FailReason = null; // 失败原因：'timeout'（时间到）或 'fall'（坠落）
        this.tutorialLevel2TimeSoundPlayed = [false, false, false, false]; // 4秒倒计时音效播放状态（对应4秒、3秒、2秒、1秒）
        // 关卡3：失败原因
        this.tutorialLevel3FailReason = null; // 失败原因：'balance'（绝对平衡时间不足）或 'fall'（坠落）
        // 关卡3：确保至少生成1次炸弹道具
        this.tutorialLevel3BombSpawned = false; // 关卡3是否已生成炸弹道具
        // 绝对平衡计时系统（累计平衡道具的持续时间）
        this.absoluteBalanceTime = 0; // 累计绝对平衡时间（帧数）
        this.absoluteBalanceTarget = 900; // 目标：15秒（60fps * 15 = 900帧）
        // 关卡4：击中机械鸟计数系统
        this.tutorialLevel4BirdsKilled = 0; // 关卡4已击中机械鸟数量
        this.tutorialLevel4BirdsTarget = 6; // 关卡4目标：击中6只

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
        
        // 偏转速度限制（度/秒）
        this.maxWindSwaySpeedPerSecond = 30; // 风力影响每秒最大偏转30度
        this.maxControlSwaySpeedPerSecond = 45; // 按键影响每秒最大偏转45度

        // 生命系统（机械鸟攻击）
        this.playerMaxHealth = 3;
        this.playerHealth = 3;
        this.lastHealth = 3; // 上一帧的血量，用于检测回血
        this.healthRegenTimer = 0; // 恢复计时（30s 回一次血）
        this.damageFlashTimer = 0; // 受击闪红计时
        this.healAnimationTimer = 0; // 回血动画计时（0表示无动画）
        this.healAnimationDuration = 30; // 回血动画持续30帧（0.5秒）
        this.healStartRatio = 0; // 回血动画开始时的血量比例

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
            birdFrames: [], // 机械鸟帧动画
            bg_cloud: null,
            end_fail: null,
            end_success: null,
            ready: false, 
            loaded: 0 
        };
        
        // 音频对象
        this.audio = {
            bgMusic: null,
            failSound: null, // 失败音效
            clapsSound: null, // 鼓掌音效
            bombFuse: null,  // 炸弹引线音效
            bombExplosion: null, // 炸弹爆炸音效
            birdSound: null, // 鸟出现音效
            bulletSound: null, // 光束发射音效
            hurtSound: null, // 受伤音效
            loaded: 0,
            ready: false
        };
        // 当前场景中存在的炸弹数量（用于控制引线音效）
        this.activeBombCount = 0;

        // 机械鸟与子弹系统
        this.mechanicalBird = {
            active: false,
            x: 0,
            y: 0,
            targetX: 0,
            targetY: 0,
            side: 'left',        // 'left' 或 'right'
            state: 'idle',       // 'idle' | 'enter' | 'stay' | 'attack' | 'dead'
            frameIndex: 0,
            frameTimer: 0,
            stayTimer: 0,
            deadTimer: 0,
            spawnTimer: 0,
            spawnInterval: 600   // 初始 10 秒（600 帧）后尝试出现
        };
        this.playerBullets = []; // 玩家发射的子弹（用于打鸟）
        // 绝对平衡输入打断计数（3次左右按键后提前结束绝对平衡）
        this.balanceInputBreakCount = 0;

        this.loadImages();
        this.loadAudio();
        // 角色帧动画
        this.sprites = { manFrames: [], loaded: 0, total: 9, ready: false };
        this.loadManFrames();

        this.particles = [];
        this.landscape = [];
        // landscapeSpeed 不再使用，动态背景使用固定流程
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
            extendSpeed: 2.5  // 提升伸缩速度，但保持一定操作难度
        };
        this.keys = {};
        // 角色动画状态（步幅与帧）
        this.player.frameIndex = 0;
        this.player.stepAccumPx = 0;
        this.player.stepLengthPx = 20; // 每走20像素切下一帧（动画速度x2）
        this.player.spriteHeight = 120; // 若后续需要按高度定位可用（目前按贴图原始尺寸）

        this.init();
        this.initUserSystem();
    }

    // 多用户存档系统
    loadUsers() {
        const saved = localStorage.getItem('tightropeUsers');
        if (saved) {
            const users = JSON.parse(saved);
            // 数据迁移：将"玩家1"重命名为"Q"
            let hasChanged = false;
            users.forEach(user => {
                if (user.name === '玩家1') {
                    user.name = 'Q';
                    hasChanged = true;
                }
            });
            if (hasChanged) {
                this.saveUsers(users);
            }
            return users;
        }
        // 兼容旧版本：如果有旧记录，迁移到新系统
        const oldHighScore = parseInt(localStorage.getItem('tightropeHighScore') || 0);
        if (oldHighScore > 0) {
            const users = [{ name: 'Q', highScore: oldHighScore }];
            this.saveUsers(users);
            localStorage.removeItem('tightropeHighScore'); // 移除旧数据
            return users;
        }
        return [];
    }

    saveUsers(users) {
        localStorage.setItem('tightropeUsers', JSON.stringify(users));
    }

    // 新手教学关卡进度系统
    loadTutorialProgress() {
        if (!this.currentUser) return { unlocked: [1], distances: {}, completed: {} }; // 默认解锁第1关
        const key = `tutorialProgress_${this.currentUser}`;
        const saved = localStorage.getItem(key);
        if (saved) {
            const data = JSON.parse(saved);
            // 兼容旧格式（只有数组的情况）
            if (Array.isArray(data)) {
                return { unlocked: data, distances: {}, completed: {} };
            }
            // 兼容旧格式（没有completed字段的情况）
            if (!data.completed) {
                data.completed = {};
            }
            return data;
        }
        return { unlocked: [1], distances: {}, completed: {} }; // 默认解锁第1关
    }

    saveTutorialProgress() {
        if (!this.currentUser) return;
        const key = `tutorialProgress_${this.currentUser}`;
        const data = {
            unlocked: this.tutorialUnlockedLevels,
            distances: this.tutorialLevelDistances || {},
            completed: this.tutorialLevelCompletedStatus || {}
        };
        localStorage.setItem(key, JSON.stringify(data));
    }

    unlockTutorialLevel(level) {
        if (!this.tutorialUnlockedLevels.includes(level)) {
            this.tutorialUnlockedLevels.push(level);
            this.saveTutorialProgress();
        }
    }

    saveTutorialLevelDistance(level, distance) {
        // 保存关卡的最远距离（不更新highScore）
        if (!this.tutorialLevelDistances) {
            this.tutorialLevelDistances = {};
        }
        const currentBest = this.tutorialLevelDistances[level] || 0;
        if (distance > currentBest) {
            this.tutorialLevelDistances[level] = Math.floor(distance);
            this.saveTutorialProgress();
        }
    }

    getCurrentUser() {
        return this.currentUser;
    }

    setCurrentUser(userName) {
        // 先设置当前用户，再加载该用户的关卡进度
        this.currentUser = userName;
        localStorage.setItem('currentUser', userName);
        // 重新加载关卡进度
        const tutorialProgress = this.loadTutorialProgress();
        this.tutorialUnlockedLevels = tutorialProgress.unlocked || tutorialProgress; // 兼容旧格式
        this.tutorialLevelDistances = tutorialProgress.distances || {};
        this.tutorialLevelCompletedStatus = tutorialProgress.completed || {}; // 每个关卡的通关状态（对象）
        this.tutorialLevelCompleted = false; // 当前关卡是否已完成检查（布尔值）
        const user = this.users.find(u => u.name === userName);
        this.highScore = user ? user.highScore : 0;
        this.updateUI();
    }

    createUser(userName) {
        if (!userName || userName.trim() === '') {
            alert('请输入玩家名称！');
            return false;
        }
        if (this.users.find(u => u.name === userName)) {
            alert('该玩家名称已存在！');
            return false;
        }
        this.users.push({ name: userName, highScore: 0 });
        this.saveUsers(this.users);
        this.setCurrentUser(userName);
        this.renderUserList();
        this.renderLeaderboard();
        return true;
    }

    updateUserScore(score) {
        if (!this.currentUser) return;
        const user = this.users.find(u => u.name === this.currentUser);
        if (user && score > user.highScore) {
            user.highScore = score;
            this.saveUsers(this.users);
            this.highScore = score;
        }
    }

    initUserSystem() {
        // 总是先显示用户选择界面，让用户选择或创建
        this.showUserSelection();
        this.renderUserList();
        this.renderLeaderboard();
        this.setupUserEventListeners();
        this.updateProgressBarMarkers();
        
        // 如果有保存的当前用户，自动选中但不自动开始游戏
        const savedCurrentUser = localStorage.getItem('currentUser');
        if (savedCurrentUser && this.users.find(u => u.name === savedCurrentUser)) {
            this.setCurrentUser(savedCurrentUser);
            this.renderUserList();
        }
    }

    showUserSelection() {
        const userSelection = document.getElementById('userSelection');
        const startButton = document.getElementById('startButton');
        const hardModeButton = document.getElementById('hardModeButton');
        const startScreen = document.getElementById('startScreen');
        userSelection.style.display = 'block';
        startButton.style.display = 'none';
        if (hardModeButton) {
            hardModeButton.style.display = 'none';
        }
        // 确保编辑模式状态正确
        this.editMode = false;
        this.updateEditButtons();
        startScreen.style.justifyContent = 'center';
        startScreen.style.padding = '40px';
        startScreen.style.overflowY = 'auto';
    }

    showStartButton() {
        const userSelection = document.getElementById('userSelection');
        const startButton = document.getElementById('startButton');
        const hardModeButton = document.getElementById('hardModeButton');
        const startScreen = document.getElementById('startScreen');
        userSelection.style.display = 'none';
        startButton.style.display = 'block';
        hardModeButton.style.display = 'block';
        startScreen.style.justifyContent = 'flex-end';
        startScreen.style.paddingTop = '0';
        startScreen.style.paddingLeft = '0';
        startScreen.style.paddingRight = '0';
        startScreen.style.paddingBottom = '120px'; // 下移100像素（从220px改回120px）
        startScreen.style.overflowY = 'hidden';
    }

    renderUserList() {
        const userList = document.getElementById('userList');
        userList.innerHTML = '';
        if (this.users.length === 0) {
            userList.innerHTML = '<p style="color: #999; font-size: 0.9em;">暂无玩家，请创建新玩家</p>';
            return;
        }
        this.users.forEach(user => {
            const userItem = document.createElement('div');
            userItem.className = 'user-item';
            if (this.currentUser === user.name) {
                userItem.classList.add('active');
            }
            
            const userBtn = document.createElement('button');
            userBtn.className = 'user-btn';
            
            if (this.editMode) {
                // 编辑模式：显示可编辑的输入框
                const nameWrapper = document.createElement('span');
                nameWrapper.className = 'user-name-wrapper';
                
                const nameInput = document.createElement('input');
                nameInput.type = 'text';
                nameInput.className = 'user-name-input';
                nameInput.value = user.name;
                nameInput.maxLength = 10;
                nameInput.dataset.originalName = user.name;
                
                nameWrapper.appendChild(nameInput);
                
                const scoreSpan = document.createElement('span');
                scoreSpan.className = 'user-score';
                scoreSpan.textContent = `最高: ${user.highScore}m`;
                
                userBtn.appendChild(nameWrapper);
                userBtn.appendChild(scoreSpan);
                
                // 编辑模式下，点击按钮不切换用户
                userBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    nameInput.focus();
                    nameInput.select();
                });
            } else {
                // 正常模式：显示用户名
                userBtn.innerHTML = `
                    <span class="user-name">${user.name}</span>
                    <span class="user-score">最高: ${user.highScore}m</span>
                `;
                userBtn.addEventListener('click', () => {
                    this.setCurrentUser(user.name);
                    this.renderUserList();
                    this.showStartButton();
                    this.updateProgressBarMarkers();
                });
            }
            
            userItem.appendChild(userBtn);
            
            // 只在编辑模式下显示删除按钮
            if (this.editMode) {
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'delete-user-btn';
                deleteBtn.innerHTML = '×';
                deleteBtn.title = '删除玩家';
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (confirm(`确定要删除玩家"${user.name}"吗？`)) {
                        this.deleteUser(user.name);
                    }
                });
                userItem.appendChild(deleteBtn);
            }
            
            userList.appendChild(userItem);
        });
    }

    updateEditButtons() {
        const editBtn = document.getElementById('editUsersBtn');
        const saveBtn = document.getElementById('saveUsersBtn');
        if (editBtn && saveBtn) {
            if (this.editMode) {
                editBtn.style.display = 'none';
                saveBtn.style.display = 'flex';
            } else {
                editBtn.style.display = 'flex';
                saveBtn.style.display = 'none';
            }
        }
    }

    saveUserChanges() {
        const nameInputs = document.querySelectorAll('.user-name-input');
        const nameChanges = {};
        let hasChanges = false;
        
        nameInputs.forEach(input => {
            const originalName = input.dataset.originalName;
            const newName = input.value.trim();
            
            if (newName && newName !== originalName) {
                // 检查新名称是否已存在
                const nameExists = this.users.some(u => u.name === newName && u.name !== originalName);
                if (nameExists) {
                    alert(`玩家名称"${newName}"已存在，请使用其他名称`);
                    input.value = originalName;
                    return;
                }
                
                if (newName.length > 0 && newName.length <= 10) {
                    nameChanges[originalName] = newName;
                    hasChanges = true;
                } else {
                    alert('玩家名称长度必须在1-10个字符之间');
                    input.value = originalName;
                }
            }
        });
        
        if (hasChanges) {
            // 更新用户名称
            Object.keys(nameChanges).forEach(oldName => {
                const newName = nameChanges[oldName];
                const user = this.users.find(u => u.name === oldName);
                if (user) {
                    user.name = newName;
                    
                    // 迁移关卡进度数据
                    const oldProgressKey = `tutorialProgress_${oldName}`;
                    const newProgressKey = `tutorialProgress_${newName}`;
                    const oldProgress = localStorage.getItem(oldProgressKey);
                    if (oldProgress) {
                        // 将旧的关卡进度迁移到新的键名
                        localStorage.setItem(newProgressKey, oldProgress);
                        // 删除旧的关卡进度数据
                        localStorage.removeItem(oldProgressKey);
                    }
                    
                    // 如果当前用户被重命名，更新currentUser和关卡进度
                    if (this.currentUser === oldName) {
                        this.currentUser = newName;
                        localStorage.setItem('currentUser', newName);
                        // 重新加载关卡进度（因为键名已更改）
                        const tutorialProgress = this.loadTutorialProgress();
                        this.tutorialUnlockedLevels = tutorialProgress.unlocked || tutorialProgress;
                        this.tutorialLevelDistances = tutorialProgress.distances || {};
                    }
                }
            });
            
            // 保存到localStorage
            this.saveUsers(this.users);
            this.renderLeaderboard();
            this.updateProgressBarMarkers();
        }
    }

    deleteUser(userName) {
        // 如果删除的是当前用户，清除当前用户
        if (this.currentUser === userName) {
            this.currentUser = null;
            localStorage.removeItem('currentUser');
            this.highScore = 0;
        }
        // 从用户列表中删除
        this.users = this.users.filter(u => u.name !== userName);
        this.saveUsers(this.users);
        this.renderUserList();
        this.renderLeaderboard();
        this.updateProgressBarMarkers();
        // 如果没有用户了，显示用户选择界面
        if (this.users.length === 0) {
            this.showUserSelection();
        }
    }

    renderLeaderboard() {
        const leaderboardList = document.getElementById('leaderboardList');
        leaderboardList.innerHTML = '';
        if (this.users.length === 0) {
            leaderboardList.innerHTML = '<p style="color: #999; font-size: 0.9em;">暂无记录</p>';
            return;
        }
        // 按分数排序
        const sortedUsers = [...this.users].sort((a, b) => b.highScore - a.highScore);
        sortedUsers.forEach((user, index) => {
            const rankItem = document.createElement('div');
            rankItem.className = 'rank-item';
            if (this.currentUser === user.name) {
                rankItem.classList.add('current-user');
            }
            rankItem.innerHTML = `
                <span class="rank-number">${index + 1}</span>
                <span class="rank-name">${user.name}</span>
                <span class="rank-score">${user.highScore}m</span>
            `;
            leaderboardList.appendChild(rankItem);
        });
    }

    // 渲染游戏结束页面的排行榜
    renderGameOverLeaderboard() {
        const leaderboardList = document.getElementById('gameOverLeaderboardList');
        if (!leaderboardList) return;
        leaderboardList.innerHTML = '';
        if (this.users.length === 0) {
            leaderboardList.innerHTML = '<p style="color: rgba(255,255,255,0.6); font-size: 0.9em; padding: 10px;">暂无记录</p>';
            return;
        }
        // 按分数排序
        const sortedUsers = [...this.users].sort((a, b) => b.highScore - a.highScore);
        sortedUsers.forEach((user, index) => {
            const rankItem = document.createElement('div');
            rankItem.className = 'game-over-rank-item';
            if (this.currentUser === user.name) {
                rankItem.classList.add('current-user');
            }
            rankItem.innerHTML = `
                <span class="rank-number">${index + 1}</span>
                <span class="rank-name">${user.name}</span>
                <span class="rank-score">${user.highScore}m</span>
            `;
            leaderboardList.appendChild(rankItem);
        });
    }

    setupUserEventListeners() {
        document.getElementById('createUserBtn').addEventListener('click', () => {
            const userName = document.getElementById('newUserName').value.trim();
            if (this.createUser(userName)) {
                document.getElementById('newUserName').value = '';
                this.showStartButton();
            }
        });

        document.getElementById('newUserName').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                document.getElementById('createUserBtn').click();
            }
        });

        // 编辑按钮
        const editUsersBtn = document.getElementById('editUsersBtn');
        if (editUsersBtn) {
            editUsersBtn.addEventListener('click', () => {
                this.editMode = true;
                this.updateEditButtons();
                this.renderUserList();
            });
        }

        // 保存按钮
        const saveUsersBtn = document.getElementById('saveUsersBtn');
        if (saveUsersBtn) {
            saveUsersBtn.addEventListener('click', () => {
                this.saveUserChanges();
                this.editMode = false;
                this.updateEditButtons();
                this.renderUserList();
            });
        }

        // 切换玩家按钮
        const switchUserBtn = document.getElementById('switchUserBtn');
        if (switchUserBtn) {
            switchUserBtn.addEventListener('click', () => {
                document.getElementById('gameOver').style.display = 'none';
                document.getElementById('startScreen').style.display = 'flex';
                this.showUserSelection();
                this.renderUserList();
                this.renderLeaderboard();
            });
        }
    }

    // 初始化音频系统
    initAudio() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.log('Web Audio API 不支持');
        }
    }

    // 播放游戏结束音效（失败音效）
    playGameOverSound() {
        try {
            // 创建音频元素播放失败音效
            const failSound = new Audio('fail.MP3');
            failSound.volume = 0.35; // 设置音量为35%（原来的一半）
            failSound.playbackRate = 1.5; // 设置播放速度为1.5倍
            failSound.play().catch(e => {
                console.warn('失败音效播放失败:', e);
            });
            // 保存音频对象，以便后续停止
            this.audio.failSound = failSound;
        } catch (e) {
            console.warn('无法加载失败音效文件:', e);
        }
    }

    // 播放新纪录音效（鼓掌声音）
    playNewRecordSound() {
        try {
            // 先停止之前的鼓掌音效（如果正在播放）
            this.stopClapsSound();
            // 创建音频元素播放鼓掌音效
            const clapSound = new Audio('claps.MP3');
            clapSound.volume = 0.7; // 设置音量为70%
            clapSound.play().catch(e => {
                console.warn('新纪录音效播放失败:', e);
            });
            // 保存音频对象，以便后续停止
            this.audio.clapsSound = clapSound;
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
            if (this.images.loaded >= 16) { 
                this.images.ready = true; 
                setBgLayer(); 
                this.checkAllResourcesLoaded(); // 检查所有资源是否加载完成
            } // 3个背景图 + 5个道具图 + 5个背景运动元素图 + 1个云层图 + 2个结束界面图
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
        
        // 加载游戏结束界面图片
        const end_fail = new Image();
        end_fail.onload = onLoaded;
        end_fail.src = 'image/end_fail.jpg';
        
        const end_success = new Image();
        end_success.onload = onLoaded;
        end_success.src = 'image/end_success.jpg';

        // 机械鸟帧动画（bird_1 ~ bird_14）
        this.images.birdFrames = [];
        for (let i = 1; i <= 14; i++) {
            const bird = new Image();
            bird.onload = () => {
                onLoaded();
                // 输出第一张图片的尺寸信息（所有帧应该尺寸相同）
                if (i === 1) {
                    console.log(`机械鸟图片原始尺寸: ${bird.naturalWidth} × ${bird.naturalHeight} 像素`);
                    console.log(`缩放系数: 1 (100%)`);
                    console.log(`实际绘制尺寸: ${bird.naturalWidth} × ${bird.naturalHeight} 像素`);
                }
            };
            bird.src = `image/bird_${i}.png`;
            this.images.birdFrames.push(bird);
        }
        
        
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
        this.images.end_fail = end_fail;
        this.images.end_success = end_success;
    }

    loadAudio() {
        const onAudioLoaded = () => {
            this.audio.loaded++;
            console.log('音频加载完成，已加载:', this.audio.loaded);
            // 背景音乐 + 炸弹引线 + 炸弹爆炸，至少三个音频就绪
            if (this.audio.loaded >= 3) {
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

        // 加载炸弹引线音效
        const fuseAudio = new Audio();
        fuseAudio.oncanplaythrough = () => {
            console.log('炸弹引线音效可以播放');
            onAudioLoaded();
        };
        fuseAudio.onerror = (e) => {
            console.warn('炸弹引线音效文件不存在或加载失败，游戏将继续运行', e);
            onAudioLoaded();
        };
        fuseAudio.src = 'fuse.MP3';
        fuseAudio.loop = true;
        fuseAudio.volume = 0.6;
        fuseAudio.preload = 'auto';
        this.audio.bombFuse = fuseAudio;

        // 加载炸弹爆炸音效
        const bombAudio = new Audio();
        bombAudio.oncanplaythrough = () => {
            console.log('炸弹爆炸音效可以播放');
            onAudioLoaded();
        };
        bombAudio.onerror = (e) => {
            console.warn('炸弹爆炸音效文件不存在或加载失败，游戏将继续运行', e);
            onAudioLoaded();
        };
        bombAudio.src = 'bomb.MP3';
        bombAudio.volume = 0.6;
        bombAudio.preload = 'auto';
        this.audio.bombExplosion = bombAudio;

        // 加载鸟出现音效
        const birdAudio = new Audio();
        birdAudio.onerror = (e) => {
            console.warn('鸟出现音效文件不存在或加载失败，游戏将继续运行', e);
        };
        birdAudio.src = 'bird.MP3';
        birdAudio.volume = 0.7;
        birdAudio.preload = 'auto';
        this.audio.birdSound = birdAudio;

        // 加载光束发射音效
        const bulletAudio = new Audio();
        bulletAudio.onerror = (e) => {
            console.warn('光束发射音效文件不存在或加载失败，游戏将继续运行', e);
        };
        bulletAudio.src = 'biu.MP3';
        bulletAudio.volume = 0.1; // 降低音量（从0.6降到0.1）
        bulletAudio.preload = 'auto';
        this.audio.bulletSound = bulletAudio;

        // 加载受伤音效
        const hurtAudio = new Audio();
        hurtAudio.onerror = (e) => {
            console.warn('受伤音效文件不存在或加载失败，游戏将继续运行', e);
        };
        hurtAudio.src = 'hurt.MP3';
        hurtAudio.volume = 0.5;
        hurtAudio.preload = 'auto';
        this.audio.hurtSound = hurtAudio;

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

    stopFailSound() {
        if (this.audio.failSound) {
            this.audio.failSound.pause();
            this.audio.failSound.currentTime = 0;
            this.audio.failSound = null;
        }
    }

    stopClapsSound() {
        if (this.audio.clapsSound) {
            this.audio.clapsSound.pause();
            this.audio.clapsSound.currentTime = 0;
            this.audio.clapsSound = null;
        }
    }

    stopAllSounds() {
        // 停止所有音效
        this.stopBackgroundMusic();
        this.stopFailSound();
        this.stopClapsSound();
        this.stopBirdSound();
        
        // 停止其他音效
        if (this.audio.bombFuse) {
            this.audio.bombFuse.pause();
            this.audio.bombFuse.currentTime = 0;
        }
        if (this.audio.bombExplosion) {
            this.audio.bombExplosion.pause();
            this.audio.bombExplosion.currentTime = 0;
        }
        if (this.audio.bulletSound) {
            this.audio.bulletSound.pause();
            this.audio.bulletSound.currentTime = 0;
        }
        if (this.audio.hurtSound) {
            this.audio.hurtSound.pause();
            this.audio.hurtSound.currentTime = 0;
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
            // 绝对平衡期间，左右键按下计数；累计3次则提前结束绝对平衡
            if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
                const balancePowerUp = this.activePowerUps && this.activePowerUps.find(p => p.type === 'balance' && p.immuneToInput && p.balanceRestore);
                if (balancePowerUp) {
                    this.balanceInputBreakCount = (this.balanceInputBreakCount || 0) + 1;
                    if (this.balanceInputBreakCount >= 3) {
                        this.clearBalanceEffect();
                        this.balanceInputBreakCount = 0;
                    }
                }
            }
            // 炸弹救援阶段按下随机按键触发绝处逃生
            if (this.bombRescue.active && !this.bombRescue.resolved && e.code === this.bombRescue.rescueKey) {
                e.preventDefault();
                this.handleBombRescueSuccess();
                return;
            }
            // 炸弹绝处逢生阶段，禁止空格键暂停/开始游戏
            if (this.bombRescue.active && !this.bombRescue.resolved && e.code === 'Space') {
                e.preventDefault();
                return;
            }
            // 机械鸟射击：按下 C 发射子弹（从平衡杆两端端头，沿平衡杆方向相反方向各射出一枚）
            if (!this.bombRescue.active && e.code === 'KeyC') {
                // 播放光束发射音效
                this.playBulletSound();
                const angleRad = this.player.sway * Math.PI / 180;
                const pivotX = this.balancePivot.x + 7; // 与平衡杆绘制的旋转中心保持一致
                const pivotY = this.balancePivot.y + 2;
                const rodHalfLen = this.balanceRod.length;
                const margin = 10; // 稍微从杆内向外一点
                const along = rodHalfLen + margin;
                // 平衡杆贴图在 drawPlayer 中的垂直偏移：-ih/2 - 265，
                // 杆的中轴线大致在 pivot 上方 265 像素处，这里取同样的 265 让子弹与杆对齐
                const rodOffsetY = -265;
                // 计算左右两端的局部坐标 (+along, rodOffsetY) 和 (-along, rodOffsetY)，再旋转到世界坐标
                const localRightX = along;
                const localLeftX = -along;
                const localY = rodOffsetY;
                const cosA = Math.cos(angleRad);
                const sinA = Math.sin(angleRad);
                // 右端
                const startRightX = pivotX + cosA * localRightX - sinA * localY;
                const startRightY = pivotY + sinA * localRightX + cosA * localY;
                // 左端
                const startLeftX = pivotX + cosA * localLeftX - sinA * localY;
                const startLeftY = pivotY + sinA * localLeftX + cosA * localY;
                const bulletSpeed = 14;
                // 一枚从右端向"右侧"飞行
                const rightVx = cosA * bulletSpeed;
                const rightVy = sinA * bulletSpeed;
                const rightAngle = Math.atan2(rightVy, rightVx);
                this.playerBullets.push({
                    x: startRightX,
                    y: startRightY,
                    vx: rightVx,
                    vy: rightVy,
                    radius: 8, // 保留用于碰撞检测
                    angle: rightAngle, // 激光光束方向角度
                    length: 30 // 激光光束长度
                });
                // 一枚从左端向"左侧"飞行
                const leftVx = -cosA * bulletSpeed;
                const leftVy = -sinA * bulletSpeed;
                const leftAngle = Math.atan2(leftVy, leftVx);
                this.playerBullets.push({
                    x: startLeftX,
                    y: startLeftY,
                    vx: leftVx,
                    vy: leftVy,
                    radius: 8, // 保留用于碰撞检测
                    angle: leftAngle, // 激光光束方向角度
                    length: 30 // 激光光束长度
                });
            }
            if (e.code === 'Space') {
                e.preventDefault(); // 防止页面滚动
                
                // 检查是否在玩家选择界面或新手教学界面，如果是则不响应
                const startScreen = document.getElementById('startScreen');
                const tutorialLevelSelect = document.getElementById('tutorialLevelSelect');
                const tutorialLevelInfo = document.getElementById('tutorialLevelInfo');
                const tutorialLevelEnd = document.getElementById('tutorialLevelEnd');
                const userSelection = document.getElementById('userSelection');
                const gameOver = document.getElementById('gameOver');
                
                // 如果玩家选择界面显示，不响应空格键
                if (userSelection && userSelection.style.display !== 'none') {
                    return;
                }
                // 如果新手教学选择界面显示，不响应空格键
                if (tutorialLevelSelect && tutorialLevelSelect.style.display !== 'none') {
                    return;
                }
                // 如果关卡说明界面显示，不响应空格键
                if (tutorialLevelInfo && tutorialLevelInfo.style.display !== 'none') {
                    return;
                }
                // 如果关卡结束界面显示，不响应空格键
                if (tutorialLevelEnd && tutorialLevelEnd.style.display !== 'none') {
                    return;
                }
                // 如果游戏结束界面显示，不响应空格键
                if (gameOver && gameOver.style.display !== 'none') {
                    return;
                }
                
                if (!this.gameRunning) {
                    // 检查是否有用户，如果没有则显示用户选择界面
                    if (!this.currentUser) {
                        this.showUserSelection();
                        return;
                    }
                    // 检查是否在首页（startScreen显示且startButton显示）
                    const startButton = document.getElementById('startButton');
                    // 使用getComputedStyle检查元素是否可见
                    const startScreenStyle = window.getComputedStyle(startScreen);
                    const startButtonStyle = startButton ? window.getComputedStyle(startButton) : null;
                    const isStartScreenVisible = startScreenStyle.display !== 'none' && startScreenStyle.visibility !== 'hidden';
                    const isStartButtonVisible = startButtonStyle && startButtonStyle.display !== 'none' && startButtonStyle.visibility !== 'hidden';
                    
                    if (isStartScreenVisible && isStartButtonVisible) {
                        // 在首页时，空格键触发高难度模式
                        this.startHardModeGame();
                        return;
                    }
                    // 不在首页时，正常开始游戏
                    this.startGame();
                } else {
                    this.togglePause();
                }
            }
        });

        document.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
        });

        // 开始按钮点击事件（新手教学，只能鼠标点击）
        document.getElementById('startButton').addEventListener('click', () => {
            if (!this.gameRunning) {
                // 检查是否有用户，如果没有则显示用户选择界面
                if (!this.currentUser) {
                    this.showUserSelection();
                    return;
                }
                // 显示关卡选择界面
                this.showTutorialLevelSelect();
            }
        });

        // 高难度模式按钮点击事件
        const hardModeButton = document.getElementById('hardModeButton');
        if (hardModeButton) {
            hardModeButton.addEventListener('click', () => {
                if (!this.gameRunning) {
                    // 检查是否有用户，如果没有则显示用户选择界面
                    if (!this.currentUser) {
                        this.showUserSelection();
                        return;
                    }
                    this.startHardModeGame();
                }
            });
        }

        // 重新挑战按钮点击事件
        const restartBtn = document.getElementById('restartBtn');
        if (restartBtn) {
            restartBtn.addEventListener('click', () => {
                if (!this.gameRunning) {
                    // 停止结算界面的音效
                    this.stopFailSound();
                    this.stopClapsSound();
                    // 检查是否有用户，如果没有则显示用户选择界面
                    if (!this.currentUser) {
                        this.showUserSelection();
                        return;
                    }
                    this.startGame();
                }
            });
        }

        // 音频控制事件监听器
        document.getElementById('muteBtn').addEventListener('click', () => {
            this.toggleMute();
        });

        document.getElementById('volumeSlider').addEventListener('input', (e) => {
            const volume = parseInt(e.target.value) / 100;
            this.setBackgroundMusicVolume(volume);
            this.updateMuteButton();
        });

        // 用户图标点击事件 - 显示玩家选择界面
        const helpTrigger = document.getElementById('helpTrigger');
        if (helpTrigger) {
            helpTrigger.addEventListener('click', () => {
                // 如果游戏结束界面显示，先隐藏它（和切换玩家按钮行为一致）
                const gameOver = document.getElementById('gameOver');
                if (gameOver && gameOver.style.display !== 'none') {
                    gameOver.style.display = 'none';
                }
                // 显示玩家选择界面
                document.getElementById('startScreen').style.display = 'flex';
                this.showUserSelection();
                this.renderUserList();
                this.renderLeaderboard();
            });
        }

        // 新手教学关卡系统事件监听器
        this.setupTutorialEventListeners();
    }

    // 新手教学关卡系统
    setupTutorialEventListeners() {
        // 返回按钮
        const backToStartBtn = document.getElementById('backToStartBtn');
        if (backToStartBtn) {
            backToStartBtn.addEventListener('click', () => {
                this.hideTutorialLevelSelect();
            });
        }

        // 关卡选择
        const levelItems = document.querySelectorAll('.tutorial-level-item');
        levelItems.forEach(item => {
            item.addEventListener('click', () => {
                const level = parseInt(item.getAttribute('data-level'));
                if (!item.classList.contains('locked')) {
                    this.showTutorialLevelInfo(level);
                }
            });
        });

        // 开始关卡按钮
        const startLevelBtn = document.getElementById('startLevelBtn');
        if (startLevelBtn) {
            startLevelBtn.addEventListener('click', () => {
                this.startTutorialLevel(this.currentTutorialLevel);
            });
        }

        // 返回关卡选择
        const backToLevelSelectBtn = document.getElementById('backToLevelSelectBtn');
        if (backToLevelSelectBtn) {
            backToLevelSelectBtn.addEventListener('click', () => {
                this.hideTutorialLevelInfo();
            });
        }

        // 返回新手教学
        const backToTutorialBtn = document.getElementById('backToTutorialBtn');
        if (backToTutorialBtn) {
            backToTutorialBtn.addEventListener('click', () => {
                // 停止结算界面的音效
                this.stopFailSound();
                this.stopClapsSound();
                this.hideTutorialLevelEnd();
                this.tutorialMode = false; // 重置教程模式
                this.showTutorialLevelSelect();
            });
        }

        // 重新挑战按钮
        const retryLevelBtn = document.getElementById('retryLevelBtn');
        if (retryLevelBtn) {
            retryLevelBtn.addEventListener('click', () => {
                // 停止结算界面的音效
                this.stopFailSound();
                this.stopClapsSound();
                this.hideTutorialLevelEnd();
                // 重新开始当前关卡
                this.startTutorialLevel(this.currentTutorialLevel);
            });
        }

        // 下一关按钮
        const nextLevelBtn = document.getElementById('nextLevelBtn');
        if (nextLevelBtn) {
            nextLevelBtn.addEventListener('click', () => {
                // 停止结算界面的音效
                this.stopFailSound();
                this.stopClapsSound();
                this.hideTutorialLevelEnd();
                // 关卡4成功时，点击"综合挑战"进入正式游戏
                if (this.currentTutorialLevel === 4) {
                    this.tutorialMode = false;
                    this.currentTutorialLevel = 0;
                    this.startGame();
                    return;
                }
                const nextLevel = this.currentTutorialLevel + 1;
                if (nextLevel <= 4 && this.tutorialUnlockedLevels.includes(nextLevel)) {
                    // 显示下一关的关卡介绍
                    this.showTutorialLevelInfo(nextLevel);
                } else {
                    // 如果下一关未解锁，返回关卡选择界面
                    this.tutorialMode = false;
                    this.showTutorialLevelSelect();
                }
            });
        }
    }

    showTutorialLevelSelect() {
        document.getElementById('startScreen').style.display = 'none';
        document.getElementById('tutorialLevelSelect').style.display = 'flex';
        this.updateTutorialLevelSelect();
    }

    hideTutorialLevelSelect() {
        document.getElementById('tutorialLevelSelect').style.display = 'none';
        document.getElementById('startScreen').style.display = 'flex';
    }

    updateTutorialLevelSelect() {
        const levelItems = document.querySelectorAll('.tutorial-level-item');
        levelItems.forEach(item => {
            const level = parseInt(item.getAttribute('data-level'));
            if (this.tutorialUnlockedLevels.includes(level)) {
                item.classList.remove('locked');
                const statusEl = item.querySelector('.level-status');
                if (statusEl) {
                    // 检查是否已通关（对于关卡3，需要检查completed状态；其他关卡检查距离记录）
                    const isCompleted = this.tutorialLevelCompletedStatus && this.tutorialLevelCompletedStatus[level];
                    const bestDistance = this.tutorialLevelDistances && this.tutorialLevelDistances[level];
                    
                    if (level === 3) {
                        // 关卡3：必须真正通关（completed为true）才显示"已通关"
                        if (isCompleted && bestDistance && bestDistance > 0) {
                            statusEl.textContent = `已通关 • ${bestDistance}m`;
                        } else if (bestDistance && bestDistance > 0) {
                            // 有距离记录但未通关，显示距离但不显示"已通关"
                            statusEl.textContent = `已尝试 • ${bestDistance}m`;
                        } else {
                            statusEl.textContent = '已解锁';
                        }
                    } else {
                        // 其他关卡：有距离记录就显示"已通关"
                        if (bestDistance && bestDistance > 0) {
                            statusEl.textContent = `已通关 • ${bestDistance}m`;
                        } else {
                            statusEl.textContent = '已解锁';
                        }
                    }
                    statusEl.classList.add('unlocked');
                }
            } else {
                item.classList.add('locked');
                const statusEl = item.querySelector('.level-status');
                if (statusEl) {
                    statusEl.textContent = '🔒 未解锁';
                    statusEl.classList.remove('unlocked');
                }
            }
        });
    }

    showTutorialLevelInfo(level) {
        // 停止结算界面的音效（如果从结算界面进入）
        this.stopFailSound();
        this.stopClapsSound();
        this.currentTutorialLevel = level;
        document.getElementById('tutorialLevelSelect').style.display = 'none';
        document.getElementById('tutorialLevelInfo').style.display = 'flex';
        
        const titleEl = document.getElementById('levelInfoTitle');
        const contentEl = document.getElementById('levelInfoContent');
        
        if (level === 1) {
            titleEl.textContent = '关卡1：基础平衡';
            contentEl.className = 'level-info-content level-info-image';
            contentEl.innerHTML = `
                <img src="image/level1.png" alt="关卡1说明" style="width: 100%; height: auto; display: block;">
            `;
        } else if (level === 2) {
            titleEl.textContent = '关卡2：道具收集';
            contentEl.className = 'level-info-content level-info-image';
            contentEl.innerHTML = `
                <img src="image/level2.png" alt="关卡2说明" style="width: 100%; height: auto; display: block;">
            `;
        } else if (level === 3) {
            titleEl.textContent = '关卡3：绝处逢生';
            contentEl.className = 'level-info-content level-info-image';
            contentEl.innerHTML = `
                <img src="image/level3.png" alt="关卡3说明" style="width: 100%; height: auto; display: block;">
            `;
        } else if (level === 4) {
            titleEl.textContent = '关卡4：击退怪鸟';
            contentEl.className = 'level-info-content level-info-image';
            contentEl.innerHTML = `
                <img src="image/level4.png" alt="关卡4说明" style="width: 100%; height: auto; display: block;">
            `;
        } else {
            titleEl.textContent = `关卡${level}`;
            contentEl.className = 'level-info-content';
            contentEl.innerHTML = '<p>关卡说明待完善</p>';
        }
    }

    hideTutorialLevelInfo() {
        document.getElementById('tutorialLevelInfo').style.display = 'none';
        document.getElementById('tutorialLevelSelect').style.display = 'flex';
    }

    hideTutorialLevelEnd() {
        document.getElementById('tutorialLevelEnd').style.display = 'none';
    }

    startTutorialLevel(level) {
        this.tutorialMode = true;
        this.currentTutorialLevel = level;
        this.tutorialPassedDistance = 0;
        this.tutorialLevelCompleted = false; // 重置完成标志
        
        // 停止所有音效（包括结算界面的音效）
        this.stopFailSound();
        this.stopClapsSound();
        this.stopAllSounds();
        
        // 隐藏所有界面
        document.getElementById('tutorialLevelInfo').style.display = 'none';
        document.getElementById('tutorialLevelSelect').style.display = 'none';
        document.getElementById('startScreen').style.display = 'none';
        document.getElementById('gameOver').style.display = 'none';
        document.getElementById('pauseScreen').style.display = 'none';
        
        // 重置游戏状态
        this.resetGame();
        
        // 根据关卡设置特殊规则
        if (level === 1) {
            // 关卡1：禁用道具、禁用怪鸟、禁用平衡杆控制
            this.tutorialLevel1Mode = true;
            this.tutorialTargetDistance = 200; // 关卡1目标200m
        } else if (level === 2) {
            // 关卡2：启用道具系统（仅加速和减速）、禁用怪鸟、启用平衡杆控制
            this.tutorialLevel1Mode = false;
            this.tutorialLevel2Mode = true;
            this.tutorialTargetDistance = 400; // 关卡2目标400m
            this.tutorialLevel2TimeElapsed = 0; // 重置时间计数器
            this.tutorialLevel2FailReason = null; // 重置失败原因
            this.tutorialLevel2TimeSoundPlayed = [false, false, false, false]; // 重置音效播放标志
        } else if (level === 3) {
            // 关卡3：启用道具系统（仅平衡、失衡、炸弹）、禁用怪鸟、启用平衡杆控制
            this.tutorialLevel1Mode = false;
            this.tutorialLevel2Mode = false;
            this.tutorialTargetDistance = 400; // 关卡3目标400m
            this.tutorialLevel3BombSpawned = false; // 重置炸弹生成标志
            this.tutorialLevel3FailReason = null; // 重置关卡3失败原因
        } else if (level === 4) {
            // 关卡4：仅启用怪鸟，禁用道具，启用平衡杆控制
            this.tutorialLevel1Mode = false;
            this.tutorialLevel2Mode = false;
            this.tutorialTargetDistance = 0; // 关卡4没有距离要求
            this.tutorialLevel4BirdsKilled = 0; // 重置击中计数
        }
        
        // 开始游戏
        this.gameRunning = true;
        this.gamePaused = false;
        this.gameStarted = true;
        
        // 开始播放背景音乐
        setTimeout(() => {
            this.playBackgroundMusic();
        }, 100);
        
        this.update();
    }

    checkTutorialLevelComplete() {
        if (!this.tutorialMode) return false;
        
        // 关卡4：检查是否击中6只机械鸟
        if (this.currentTutorialLevel === 4) {
            if (this.tutorialLevel4BirdsKilled >= this.tutorialLevel4BirdsTarget && !this.tutorialLevelCompleted) {
                this.tutorialLevelCompleted = true;
                // 解锁下一关（如果有）
                const nextLevel = this.currentTutorialLevel + 1;
                if (nextLevel <= 4) {
                    this.unlockTutorialLevel(nextLevel);
                }
                // 显示通关提示，但允许继续游戏
                this.showTutorialLevelCompleteMessage();
                // 不立即结束，允许继续游戏
                return false; // 返回false，让游戏继续
            }
            return false;
        }
        
        // 关卡2：检查是否达到400m且在时间限制内
        if (this.currentTutorialLevel === 2) {
            // 检查是否超时（无论是否通关，时间到了都要结束）
            if (this.tutorialLevel2TimeElapsed >= this.tutorialLevel2TimeLimit) {
                // 超时
                if (!this.tutorialLevelCompleted) {
                    // 未通关则失败
                    this.tutorialLevelCompleted = true;
                    this.tutorialLevel2FailReason = 'timeout'; // 设置失败原因为时间到
                    this.endTutorialLevel(false); // 失败
                    return true; // 停止更新
                } else {
                    // 已通关，但时间到了也要结束（记录当前距离）
                    this.endTutorialLevel(true);
                    return true; // 停止更新
                }
            }
            // 检查是否达到目标距离
            if (this.distance >= this.tutorialTargetDistance && !this.tutorialLevelCompleted) {
                this.tutorialLevelCompleted = true;
                // 解锁下一关
                const nextLevel = this.currentTutorialLevel + 1;
                if (nextLevel <= 4) {
                    this.unlockTutorialLevel(nextLevel);
                }
                // 显示通关提示，但允许继续游戏
                this.showTutorialLevelCompleteMessage();
                // 不立即结束，允许继续向前走
                return false; // 返回false，让游戏继续
            }
            return false;
        }
        
        // 其他关卡：检查是否达到目标距离（只检查一次，避免重复触发）
        if (this.distance >= this.tutorialTargetDistance && !this.tutorialLevelCompleted) {
            // 关卡3：需要同时达到距离目标和绝对平衡目标（15秒）
            if (this.currentTutorialLevel === 3) {
                if (this.absoluteBalanceTime >= this.absoluteBalanceTarget) {
                    // 标记关卡3为已通关
                    this.tutorialLevelCompletedStatus[3] = true;
                    this.saveTutorialProgress();
                    // 标记为已处理，避免重复触发
                    this.tutorialLevelCompleted = true;
                    // 解锁下一关
                    const nextLevel = this.currentTutorialLevel + 1;
                    if (nextLevel <= 4) {
                        this.unlockTutorialLevel(nextLevel);
                    }
                    // 显示通关提示，但允许继续游戏
                    this.showTutorialLevelCompleteMessage();
                    // 不立即结束，允许继续向前走
                    return false; // 返回false，让游戏继续
                } else {
                    // 距离达到但绝对平衡时间不足，直接失败
                    this.tutorialLevelCompleted = true; // 标记为已处理，避免重复触发
                    this.tutorialLevel3FailReason = 'balance'; // 设置失败原因为绝对平衡时间不足
                    this.endTutorialLevel(false); // 显示失败界面
                    return true; // 停止游戏更新
                }
            } else {
                // 其他关卡：只检查距离
                // 标记当前关卡为已通关
                this.tutorialLevelCompletedStatus[this.currentTutorialLevel] = true;
                this.saveTutorialProgress();
                // 标记为已处理，避免重复触发
                this.tutorialLevelCompleted = true;
                // 解锁下一关
                const nextLevel = this.currentTutorialLevel + 1;
                if (nextLevel <= 4) {
                    this.unlockTutorialLevel(nextLevel);
                }
                // 显示通关提示，但允许继续游戏
                this.showTutorialLevelCompleteMessage();
                // 不立即结束，允许继续向前走
                return false; // 返回false，让游戏继续
            }
        }
        return false;
    }

    showTutorialLevelCompleteMessage() {
        // 播放通关音效
        try {
            // 先停止之前的鼓掌音效（如果正在播放）
            this.stopClapsSound();
            const clapSound = new Audio('claps.MP3');
            clapSound.volume = 0.7;
            clapSound.play().catch(e => {
                console.log('音效播放失败:', e);
            });
            // 保存音频对象，以便后续停止
            this.audio.clapsSound = clapSound;
        } catch (e) {
            console.log('音效加载失败:', e);
        }

        const effectText = document.createElement('div');
        effectText.style.position = 'absolute';
        effectText.style.left = '50%';
        effectText.style.top = '30%';
        effectText.style.transform = 'translateX(-50%)';
        effectText.style.color = '#FFD700'; // 改为金色
        effectText.style.fontSize = '42px'; // 减小字体
        effectText.style.fontWeight = 'bold';
        effectText.style.pointerEvents = 'none';
        effectText.style.zIndex = '1000';
        effectText.style.textAlign = 'center';
        effectText.style.textShadow = '3px 3px 6px rgba(0,0,0,0.8), 0 0 10px rgba(255,215,0,0.5)'; // 添加金色光晕效果
        effectText.textContent = '已通关';
        
        document.body.appendChild(effectText);
        
        let opacity = 1;
        let y = 30; // 初始Y位置
        let stayTime = 0; // 停留时间计数器
        const stayDuration = 90; // 停留90帧（约1.5秒在60fps下）
        const animate = () => {
            if (stayTime < stayDuration) {
                // 停留阶段：保持完全不透明，不移动
                stayTime++;
            } else {
                // 淡出阶段：开始淡出并向上移动
                opacity -= 0.015; // 减慢消失速度（从0.02改为0.015）
                y -= 0.3; // 向上移动
                effectText.style.opacity = opacity;
                effectText.style.top = y + '%';
            }
            
            if (opacity > 0) {
                requestAnimationFrame(animate);
            } else {
                // 完全消失后移除元素
                if (document.body.contains(effectText)) {
                    document.body.removeChild(effectText);
                }
            }
        };
        animate();
    }

    endTutorialLevel(success) {
        this.gameRunning = false;
        // 注意：不立即关闭tutorialMode，以便返回按钮能正常工作
        
        // 关闭所有音效（但不停止炸弹爆炸音效，让它播放完）
        this.stopBombFuseSound();
        this.stopBackgroundMusic();
        // 不调用stopAllSounds()，避免停止炸弹爆炸音效
        
        // 隐藏所有其他界面
        document.getElementById('startScreen').style.display = 'none';
        document.getElementById('tutorialLevelSelect').style.display = 'none';
        document.getElementById('tutorialLevelInfo').style.display = 'none';
        document.getElementById('gameOver').style.display = 'none';
        document.getElementById('pauseScreen').style.display = 'none';
        
        const endScreen = document.getElementById('tutorialLevelEnd');
        const titleEl = document.getElementById('levelEndTitle');
        const messageEl = document.getElementById('levelEndMessage');
        const distanceEl = document.getElementById('levelEndDistance');
        
        // 获取按钮元素
        const nextLevelBtn = document.getElementById('nextLevelBtn');
        const retryLevelBtn = document.getElementById('retryLevelBtn');
        
        if (success) {
            // 成功时播放通关音效
            try {
                // 先停止之前的鼓掌音效（如果正在播放）
                this.stopClapsSound();
                const clapSound = new Audio('claps.MP3');
                clapSound.volume = 0.7;
                clapSound.play().catch(e => {
                    console.log('通关音效播放失败:', e);
                });
                // 保存音频对象，以便后续停止
                this.audio.clapsSound = clapSound;
            } catch (e) {
                console.log('通关音效加载失败:', e);
            }
            
            titleEl.textContent = '关卡通关！';
            messageEl.textContent = '恭喜你完成了本关卡！';
            messageEl.className = 'level-end-message success';
            
            // 显示"下一关"按钮，隐藏"重新挑战"按钮
            if (nextLevelBtn) {
                nextLevelBtn.style.display = 'block';
                // 关卡4成功时，按钮文本改为"综合挑战"
                if (this.currentTutorialLevel === 4) {
                    nextLevelBtn.textContent = '综合挑战';
                } else {
                    nextLevelBtn.textContent = '下一关';
                }
            }
            if (retryLevelBtn) {
                retryLevelBtn.style.display = 'none';
            }
        } else {
            // 失败时播放失败音效
            try {
                // 先停止之前的失败音效（如果正在播放）
                this.stopFailSound();
                const failSound = new Audio('fail.MP3');
                failSound.volume = 0.7;
                failSound.play().catch(e => {
                    console.log('失败音效播放失败:', e);
                });
                // 保存音频对象，以便后续停止
                this.audio.failSound = failSound;
            } catch (e) {
                console.log('失败音效加载失败:', e);
            }
            
            titleEl.textContent = '关卡失败';
            if (this.currentTutorialLevel === 2) {
                // 根据失败原因显示不同的消息
                if (this.tutorialLevel2FailReason === 'timeout') {
                    messageEl.textContent = '时间到了！你需要在50秒内完成400米';
                } else if (this.tutorialLevel2FailReason === 'fall') {
                    messageEl.textContent = '很遗憾，你未能保持平衡，从钢丝上摔下去了';
                } else {
                    messageEl.textContent = '很遗憾，你未能完成本关卡';
                }
            } else if (this.currentTutorialLevel === 3) {
                // 根据失败原因显示不同的消息
                if (this.tutorialLevel3FailReason === 'balance') {
                    messageEl.textContent = '你已到达400米，但绝对平衡时间未达到15秒';
                } else if (this.tutorialLevel3FailReason === 'fall') {
                    messageEl.textContent = '很遗憾，你未能保持平衡，从钢丝上摔下去了';
                } else {
                    messageEl.textContent = '很遗憾，你未能完成本关卡';
                }
            } else {
                messageEl.textContent = '很遗憾，你未能完成本关卡';
            }
            messageEl.className = 'level-end-message failed';
            
            // 显示"重新挑战"按钮，隐藏"下一关"按钮
            if (nextLevelBtn) {
                nextLevelBtn.style.display = 'none';
                // 重置按钮文本为默认值（失败时隐藏，但重置以备用）
                nextLevelBtn.textContent = '下一关';
            }
            if (retryLevelBtn) {
                retryLevelBtn.style.display = 'block';
            }
        }
        
        // 根据关卡显示不同的信息
        if (this.currentTutorialLevel === 4) {
            distanceEl.textContent = `你击中了 ${this.tutorialLevel4BirdsKilled} 只机械鸟`;
        } else {
            distanceEl.textContent = `你走了 ${Math.floor(this.distance)} 米`;
        }
        distanceEl.className = 'level-end-distance';
        
        // 保存关卡最远距离（不计入排行榜）
        if (this.currentTutorialLevel > 0) {
            this.saveTutorialLevelDistance(this.currentTutorialLevel, this.distance);
        }
        
        // 如果失败，确保不标记为已通关（特别是关卡3）
        if (!success && this.currentTutorialLevel === 3) {
            this.tutorialLevelCompletedStatus[3] = false;
            this.saveTutorialProgress();
        }
        
        endScreen.style.display = 'flex';
    }

    startGame() {
        this.gameRunning = true;
        this.gamePaused = false;
        this.gameStarted = true;
        // 停止所有音效（包括结算界面的音效）
        this.stopFailSound();
        this.stopClapsSound();
        this.stopAllSounds();
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

    startHardModeGame() {
        // 高难度模式：直接开始游戏（可以在这里添加高难度逻辑）
        this.startGame();
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
        // 停止所有音效（包括结算界面的音效）
        this.stopFailSound();
        this.stopClapsSound();
        this.stopAllSounds();
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
        this.speed = 0.1; // 重置速度为初始值（从0.083提升到0.1）
        this.gameFrameCount = 0; // 重置游戏帧计数器
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
        // 重置生命与受击状态
        this.playerHealth = this.playerMaxHealth;
        this.lastHealth = this.playerMaxHealth;
        this.healthRegenTimer = 0;
        this.healAnimationTimer = 0;
        this.healStartRatio = 1;
        this.damageFlashTimer = 0;
        // 重置机械鸟与子弹
        this.mechanicalBird.active = false;
        this.mechanicalBird.state = 'idle';
        this.mechanicalBird.spawnTimer = 0;
        // 关卡4：第一只在2-4秒后生成（120-240帧随机），之后在被击中或攻击玩家后2-4秒生成
        if (this.tutorialMode && this.currentTutorialLevel === 4) {
            this.mechanicalBird.spawnInterval = 120 + Math.floor(Math.random() * 120); // 2-4秒随机
        } else {
            this.mechanicalBird.spawnInterval = 600 + Math.floor(Math.random() * 300);
        }
        this.playerBullets = [];
        // 重置垂死挣扎/炸弹救援状态
        this.dangerZoneTimer = 0;
        this.bombRescue.active = false;
        this.bombRescue.timer = 0;
        this.bombRescue.resolved = false;
        this.bombRescue.contactAngle = 0;
        this.bombRescue.rescueKey = 'KeyQ'; // 重置为默认值
        this.bombRescueShield.active = false;
        this.bombRescueShield.timer = 0;
        // 重置炸弹计数并停止引线音效
        this.activeBombCount = 0;
        this.stopBombFuseSound();
        // 重置关卡2的时间计数和失败原因
        if (this.tutorialMode && this.currentTutorialLevel === 2) {
            this.tutorialLevel2TimeElapsed = 0;
            this.tutorialLevel2FailReason = null;
            this.tutorialLevel2TimeSoundPlayed = [false, false, false, false]; // 重置音效播放标志
        }
        // 重置关卡3的炸弹生成标志和失败原因
        if (this.tutorialMode && this.currentTutorialLevel === 3) {
            this.tutorialLevel3BombSpawned = false;
            this.tutorialLevel3FailReason = null;
        }
        // 重置关卡4的击中计数
        if (this.tutorialMode && this.currentTutorialLevel === 4) {
            this.tutorialLevel4BirdsKilled = 0;
        }
        // 重置绝对平衡计时
        this.absoluteBalanceTime = 0;
        // 重新加载当前用户的最高分
        if (this.currentUser) {
            const user = this.users.find(u => u.name === this.currentUser);
            this.highScore = user ? user.highScore : 0;
        }
        // 重置游戏结束标题样式
        const titleElement = document.getElementById('gameOverTitle');
        if (titleElement) {
            titleElement.style.background = '';
            titleElement.style.backgroundImage = '';
            titleElement.style.backgroundSize = '';
            titleElement.style.backgroundRepeat = '';
            titleElement.style.backgroundPosition = '';
            titleElement.style.width = '';
            titleElement.style.height = '';
            titleElement.style.minHeight = '';
            titleElement.style.textIndent = '';
            titleElement.classList.remove('has-image');
            titleElement.innerHTML = '游戏结束！';
        }
        this.updateUI();
    }

    update() {
        if (!this.gameRunning || this.gamePaused) return;
        // 如果处于炸弹Q键救援阶段，只更新救援逻辑，其余全部暂停
        if (this.bombRescue.active) {
            this.updateBombRescue();
        } else {
            this.gameFrameCount++; // 游戏帧计数器增加（用于landscape时间计算）
            this.distance += this.speed;
            this.score = Math.floor(this.distance);
            this.updateWind();
            this.updateBalanceRod(); // 先更新平衡杆长度，确保参数计算使用最新值
            this.updatePlayerBalance();
            this.updatePlayerAnimation();
            this.updateBackground();
            this.updateParticles();
            this.updateLandscape();
            
            // 新手教学模式：根据关卡禁用某些功能
            if (this.tutorialMode) {
                // 关卡1禁用道具和怪鸟
                if (this.currentTutorialLevel === 1) {
                    // 不更新道具和怪鸟
                } else if (this.currentTutorialLevel === 2) {
                    // 关卡2：启用道具系统（仅加速和减速），禁用怪鸟
                    this.updatePowerUps();
                    // 更新时间计数
                    this.tutorialLevel2TimeElapsed++;
                } else if (this.currentTutorialLevel === 3) {
                    // 关卡3：启用道具系统（仅平衡、失衡、炸弹），禁用怪鸟
                    this.updatePowerUps();
                } else if (this.currentTutorialLevel === 4) {
                    // 关卡4：启用怪鸟，禁用道具
                    this.updateMechanicalBird();
                } else {
                    // 其他关卡：正常更新
                    this.updatePowerUps();
                    this.updateMechanicalBird();
                }
                // 检查关卡是否完成
                if (this.checkTutorialLevelComplete()) {
                    return; // 关卡完成，停止更新
                }
            } else {
                // 正常模式：更新所有功能
                this.updatePowerUps();
                this.updateMechanicalBird();
            }
            
            this.updatePlayerBullets();
            // this.updateHealthRegen(); // 回血机制已禁用
            this.checkGameOver();
        }
        // 绝处逢生护罩动画独立更新（不阻塞游戏）
        this.updateBombRescueShield();
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
        // 确保动画速度有最小值，避免多次减速后完全停滞
        movePxPerFrame = Math.max(movePxPerFrame, 0.1);
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
            this.wind.changeInterval = 120 + Math.random() * 120; // 变化间隔（120-240帧，约2-4秒）
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
        // 恢复原有绝对平衡机制：期间持续强制回正并屏蔽左右输入
        if (isBalanceRestore) {
            this.player.sway = 0;
            this.player.swaySpeed = 0;
            return;
        }
        // 根据平衡杆长度计算稳定性系数（0-1之间）
        // 杆长更稳定（接近1），杆短更灵活但更易受风影响（接近0）
        let rodLengthRatio = 0.78; // 默认值
        if (this.balanceRod.baseLength > 0) {
            rodLengthRatio = (this.balanceRod.length - this.balanceRod.minLength) / 
                            (this.balanceRod.maxLength - this.balanceRod.minLength);
            rodLengthRatio = Math.max(0, Math.min(1, rodLengthRatio)); // 限制在0-1之间
        }
        
        // 杆长：更稳定（风力影响小，阻尼大）
        // 杆短：更灵活（风力影响大，阻尼小，但控制响应快）
        const stabilityFactor = rodLengthRatio; // 0（杆短）到1（杆长）
        const flexibilityFactor = 1 - rodLengthRatio; // 1（杆短）到0（杆长）
        
        // 风力影响：杆短时风力影响更大，杆长时风力影响更小
        const windMultiplier = 0.3 + flexibilityFactor * 0.2; // 0.3（杆长）到0.5（杆短）
        let windEffect = this.wind.force * this.wind.direction * windMultiplier;
        
        // 杆长时风力影响降低为40%
        const rodLengthWindReduction = 0.4 + flexibilityFactor * 0.6; // 0.4（杆长）到1.0（杆短）
        windEffect *= rodLengthWindReduction;
        
        // 根据角色偏转角度调整风力影响：15度以下100%，15-50度逐渐减少，50度以上接近0
        const absSway = Math.abs(this.player.sway);
        let windReductionFactor = 1.0; // 风力衰减系数
        if (absSway > 15) {
            if (absSway >= 50) {
                windReductionFactor = 0.05; // 50度以上风力影响接近0（保留5%）
            } else {
                // 15-50度之间线性插值：从1.0减少到0.05
                const progress = (absSway - 15) / (50 - 15); // 0到1之间
                windReductionFactor = 1.0 - progress * 0.95; // 从1.0减少到0.05
            }
        }
        windEffect *= windReductionFactor;
        
        // 重力影响：当角度大于15度时逐渐增加，加速偏离（与sway方向相同）
        let gravityEffect = 0;
        let gravityStrength = 0; // 重力强度系数（0-1），用于同时增强按键对抗
        if (absSway > 15) {
            if (absSway >= 50) {
                gravityStrength = 1.0; // 50度以上重力影响达到最大值
            } else {
                // 15-50度之间线性插值：从0增加到1.0
                const progress = (absSway - 15) / (50 - 15); // 0到1之间
                gravityStrength = progress; // 从0增加到1.0
            }
            // 重力方向与sway相同，加速偏离（sway为正时，重力为正；sway为负时，重力为负）
            let baseGravityForce = 0.04; // 基础重力强度
            // 0-500m 时重力强度降低为 85%
            if (this.distance <= 500) {
                baseGravityForce *= 0.85;
            }
            // 杆长时重力影响降低为40%
            const rodLengthGravityReduction = 0.4 + flexibilityFactor * 0.6; // 0.4（杆长）到1.0（杆短）
            gravityEffect = (this.player.sway > 0 ? 1 : -1) * baseGravityForce * gravityStrength * rodLengthGravityReduction;
        }
        
        // 控制力：杆短时响应更快，杆长时响应稍慢（整体提升2倍）
        // 当重力影响增大时，按键对抗作用也增强（与重力强度成正比）
        // 整体控制力下调为原来的90%
        const baseControlMultiplier = (0.025 + flexibilityFactor * 0.035) * 2 * 0.9; // 0.045（杆长）到0.108（杆短）
        // 根据角度增强按键控制力
        let controlEnhancement;
        if (absSway <= 15) {
            // 角度≤15度：基础增强1.0倍
            controlEnhancement = 1.0;
        } else if (absSway < 50) {
            // 15-50度：从1.0倍线性增加到1.8倍
            const progress = (absSway - 15) / (50 - 15);
            controlEnhancement = 1.0 + progress * 0.8;
        } else if (absSway < 70) {
            // 50-70度：从1.8倍线性增加到2.0倍（短杆时）
            const progress = (absSway - 50) / (70 - 50);
            // 短杆时（flexibilityFactor接近1）继续增强，长杆时保持1.8倍
            const shortRodEnhancement = 1.8 + progress * 0.2; // 从1.8增加到2.0
            controlEnhancement = 1.8 + (shortRodEnhancement - 1.8) * flexibilityFactor; // 短杆时增强，长杆时保持1.8
        } else {
            // 角度≥70度：短杆时2.0倍，长杆时1.8倍
            controlEnhancement = 1.8 + 0.2 * flexibilityFactor;
        }
        const controlMultiplier = baseControlMultiplier * controlEnhancement;
        let controlForce = 0;
        if (!isImmuneToInput) {
            if (this.keys['ArrowLeft']) controlForce = -controlMultiplier;
            if (this.keys['ArrowRight']) controlForce = controlMultiplier;
        }
        
        // 限制风力和按键影响的每秒最大偏转速度（假设60fps）
        const fps = 60;
        const maxWindSwaySpeedPerFrame = this.maxWindSwaySpeedPerSecond / fps; // 每帧最大风力偏转速度
        const maxControlSwaySpeedPerFrame = this.maxControlSwaySpeedPerSecond / fps; // 每帧最大按键偏转速度
        
        // 限制风力影响的增量
        const currentWindSpeedChange = windEffect;
        const clampedWindSpeedChange = Math.max(-maxWindSwaySpeedPerFrame, Math.min(maxWindSwaySpeedPerFrame, currentWindSpeedChange));
        
        // 限制按键影响的增量
        const currentControlSpeedChange = controlForce;
        const clampedControlSpeedChange = Math.max(-maxControlSwaySpeedPerFrame, Math.min(maxControlSwaySpeedPerFrame, currentControlSpeedChange));
        
        // 应用限制后的力（包括风力、按键和重力）
        let totalForce = clampedWindSpeedChange + clampedControlSpeedChange + gravityEffect;
        this.player.swaySpeed += totalForce;
        
        // 阻尼系数：杆长时阻尼更大（更稳定），杆短时阻尼较小（更灵活但摆动更大）
        // 基础阻尼从0.97开始，杆长时增加到0.98，杆短时降低到0.96
        let damping = 0.97 + stabilityFactor * 0.01 - flexibilityFactor * 0.01; // 0.96（杆短）到0.98（杆长）
        
        for (let powerUp of this.activePowerUps) {
            if (powerUp.type === 'balance') damping = 0.98;
            else if (powerUp.type === 'unbalance') damping = 0.90;
        }
        this.player.swaySpeed *= damping;
        this.player.sway += this.player.swaySpeed;
        this.player.sway = Math.max(-90, Math.min(90, this.player.sway));
        
        // 绝对平衡计时在updatePowerUps中更新（累计平衡道具的持续时间）
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
        // 左边元素生成（固定间隔，不受速度影响）
        this.leftSpawnTimer++;
        if (this.leftSpawnTimer >= this.leftSpawnInterval) {
            this.spawnLandscapeElement('left');
            this.leftSpawnTimer = 0;
            const baseInterval = 300 + Math.random() * 360; // 基础间隔5-12秒
            this.leftSpawnInterval = baseInterval;
        }
        
        // 右边元素生成（固定间隔，不受速度影响）
        this.rightSpawnTimer++;
        if (this.rightSpawnTimer >= this.rightSpawnInterval) {
            this.spawnLandscapeElement('right');
            this.rightSpawnTimer = 0;
            const baseInterval = 300 + Math.random() * 360; // 基础间隔5-12秒
            this.rightSpawnInterval = baseInterval;
        }
        
        // 固定基础速度，不受道具影响（视觉轨迹恒定）
        const fixedBaseSpeed = 0.1; // 提升初始速度（从0.083提升到0.1）
        // 仅用于控制平移速度的缩放系数（不影响缩放和角度）
        let moveSpeedScale = 1.0;
        for (let powerUp of this.activePowerUps) {
            if (powerUp.type === 'speed') { 
                moveSpeedScale *= 1.4;
            } else if (powerUp.type === 'slow') {
                moveSpeedScale *= 0.7;
            }
        }
        moveSpeedScale = Math.max(0.5, Math.min(moveSpeedScale, 2.0));
        
        for (let i = this.landscape.length - 1; i >= 0; i--) {
            const element = this.landscape[i];
            // 使用游戏帧数计算时间（不受道具影响）
            const framesElapsed = this.gameFrameCount - (element.spawnFrame || 0);
            const timeElapsed = framesElapsed / 60; // 转换为秒（假设60fps）
            const dir = element.dir || 1; // -1 左下，1 右下
            
            // 角度变化：基于固定时间流程，前7s是30度方向，后7s过渡到45度，再平滑过渡到60度
            // 计算目标角度
            let targetAngle;
            if (timeElapsed <= 7) {
                // 前7秒：保持30度方向
                targetAngle = 30;
            } else if (timeElapsed <= 14) {
                // 7-14秒：从30度过渡到45度
                const angleProgress = (timeElapsed - 7) / 7;
                targetAngle = 30 + (45 - 30) * angleProgress;
            } else {
                // 14秒后：从45度平滑过渡到60度
                const angleProgress = Math.min((timeElapsed - 14) / 14, 1); // 14秒内完成过渡
                targetAngle = 45 + (60 - 45) * angleProgress;
            }
            
            // 限制每帧角度变化速率：每秒最大变化5度（60fps时每帧约0.083度）
            const maxAngleChangePerSecond = 5.0; // 每秒最大变化5度
            const maxAngleChangePerFrame = maxAngleChangePerSecond / 60; // 每帧最大变化约0.083度
            
            // 初始化角度（如果不存在）
            if (element.currentAngle === undefined) {
                element.currentAngle = 30;
            }
            
            // 计算角度差，并限制变化速率
            let angleDiff = targetAngle - element.currentAngle;
            if (Math.abs(angleDiff) > maxAngleChangePerFrame) {
                angleDiff = Math.sign(angleDiff) * maxAngleChangePerFrame;
            }
            element.currentAngle += angleDiff;
            
            const currentAngle = element.currentAngle;
            
            // 速度变化：基于固定基础速度的倍数变化（只用于“流程快慢”，不改变轨迹形状）
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
            const currentSpeed = fixedBaseSpeed * speedMultiplier * moveSpeedScale;
            
            // 根据当前角度计算移动分量
            const angleRad = currentAngle * Math.PI / 180;
            const moveX = currentSpeed * Math.sin(angleRad) * dir; // 水平移动分量
            const moveY = currentSpeed * Math.cos(angleRad); // 垂直移动分量
            
            element.x += moveX;
            element.y += moveY;
            
            // 缩放逻辑：基于基础速度，与速度变化同步
            const baseScale = 0.08; // 初始缩放（减小）
            let targetScale;
            if (timeElapsed <= 7) {
                // 前7秒：从初始缩放到0.35倍（与30度角度对应，减小）
                const scaleProgress = timeElapsed / 7;
                targetScale = baseScale + (0.35 - baseScale) * scaleProgress;
            } else if (timeElapsed <= 14) {
                // 7-14秒：从0.35倍到0.7倍（与45度角度对应，减小）
                const scaleProgress = (timeElapsed - 7) / 7;
                targetScale = 0.35 + (0.7 - 0.35) * scaleProgress;
            } else {
                // 14秒后：从0.7倍到1.5倍（与60度角度对应，减小）
                const scaleProgress = Math.min((timeElapsed - 14) / 14, 1);
                targetScale = 0.7 + (1.5 - 0.7) * scaleProgress;
            }
            element.scale = Math.min(targetScale, 1.5); // 最大缩放到1.5倍（减小）
            
            if (element.y > this.height + 200 || element.x < -200 || element.x > this.width + 200) this.landscape.splice(i, 1);
        }
    }


    updatePowerUps() {
        this.powerUpSpawnTimer++;
        if (this.powerUpSpawnTimer >= this.powerUpSpawnInterval) {
            this.spawnPowerUp();
            this.powerUpSpawnTimer = 0;
            // 道具生成间隔：开局密度减半，随着距离逐渐恢复到原始密度，250米后进一步增加难度
            const baseInterval = 60 + Math.random() * 60; // 原始：60-120 帧
            let densityFactor;
            if (this.distance < 250) {
                // 0-250米：从2逐渐减到1
                densityFactor = 2 - (this.distance / 250);
            } else {
                // 250米后：继续减少，最低到0.4（更高密度）
                const progress = Math.min((this.distance - 250) / 2250, 1); // 250-2500米之间
                densityFactor = 1 - progress * 0.6; // 从1减少到0.4
            }
            this.powerUpSpawnInterval = baseInterval * densityFactor;
        }
        for (let i = this.powerUps.length - 1; i >= 0; i--) {
            const powerUp = this.powerUps[i];
            // 道具下落速度：前期减半，随着行进距离逐渐加快，250米后进一步加速
            const baseFallSpeed = 4.5; // 提升初始下落速度（从3.5提升到4.5）
            let speedFactor;
            if (this.distance < 250) {
                // 0-250米：从1.2逐渐增加到2（提升初始速度因子）
                speedFactor = 1.2 + (this.distance / 250) * 0.8;
            } else {
                // 250米后：继续加速，最高到2.5倍（更快下落）
                const progress = Math.min((this.distance - 250) / 2250, 1); // 250-2500米之间
                speedFactor = 2 + progress * 0.5; // 从2增加到2.5
            }
            powerUp.y += baseFallSpeed * speedFactor;
            if (this.checkPowerUpCollision(powerUp)) {
                this.collectPowerUp(powerUp);
                // 如果是炸弹被吃到，移除时减少计数
                if (powerUp.type === 'explosion') {
                    this.activeBombCount = Math.max(0, this.activeBombCount - 1);
                    if (this.activeBombCount === 0) {
                        this.stopBombFuseSound();
                    }
                }
                this.powerUps.splice(i, 1);
            } else if (powerUp.y > this.height + 100) {
                // 炸弹完全离场时，减少计数，并在最后一个炸弹离场后停止引线音效
                if (powerUp.type === 'explosion') {
                    this.activeBombCount = Math.max(0, this.activeBombCount - 1);
                    if (this.activeBombCount === 0) {
                        this.stopBombFuseSound();
                    }
                }
                this.powerUps.splice(i, 1);
            }
        }
        for (let i = this.activePowerUps.length - 1; i >= 0; i--) {
            const powerUp = this.activePowerUps[i];
            // 如果是平衡道具，累计绝对平衡时间
            if (powerUp.type === 'balance') {
                this.absoluteBalanceTime++;
            }
            powerUp.duration--;
            if (powerUp.duration <= 0) {
                this.deactivatePowerUp(powerUp);
                this.activePowerUps.splice(i, 1);
            }
        }
    }

        // 机械鸟逻辑：出现、停留、攻击、死亡
    updateMechanicalBird() {
        if (!this.images.birdFrames || this.images.birdFrames.length === 0) return;
        const bird = this.mechanicalBird;
        // 全局冷却：只在正常游戏状态且没有炸弹救援时计时
        if (!bird.active) {
            bird.spawnTimer++;
            // 关卡4：被击中或攻击玩家后2秒生成下一只（第一只在游戏开始2秒后）
            if (this.tutorialMode && this.currentTutorialLevel === 4) {
                if (bird.spawnTimer >= bird.spawnInterval) {
                    const centerX = this.width / 2;
                    let centerY = this.balancePivot.y - 350 - 50; // 角色上方
                    // 随机选择左右侧
                    const side = Math.random() < 0.5 ? 'right' : 'left';
                    const offset = 250 + 20; // 270像素
                    bird.side = side;
                    bird.targetX = centerX + (side === 'right' ? offset : -offset);
                    bird.targetY = centerY;
                    // 从画面外飞入
                    bird.x = side === 'right' ? this.width + 80 : -80;
                    bird.y = centerY;
                    bird.state = 'enter';
                    bird.frameIndex = 0;
                    bird.frameTimer = 0;
                    bird.stayTimer = 0;
                    bird.deadTimer = 0;
                    bird.active = true;
                    bird.spawnTimer = 0;
                    // 注意：spawnInterval会在被击中或攻击玩家时设置为120帧（2秒）
                    // 播放鸟出现音效
                    this.playBirdSound();
                }
            } else {
                // 正常模式：10-15 秒随机出现一次
                if (bird.spawnTimer >= bird.spawnInterval) {
                    const absSway = Math.abs(this.player.sway);
                    // 仅在角色倾斜 15-30 度时才有机会出现
                    if (absSway >= 15 && absSway <= 30) {
                        const centerX = this.width / 2;
                        // 鸟整体再向外20像素、向上50像素
                        let centerY = this.balancePivot.y - 350 - 50; // 角色上方再抬高50像素
                        // 当距离超过1000米时，在垂直位置上下50像素范围内随机
                        if (this.distance > 1000) {
                            const randomOffset = (Math.random() - 0.5) * 100; // -50 到 +50 像素
                            centerY += randomOffset;
                        }
                        const swaySign = this.player.sway >= 0 ? 1 : -1;
                        const side = swaySign >= 0 ? 'right' : 'left';
                        const offset = 250 + 20; // 再向外20像素 => 270
                        bird.side = side;
                        bird.targetX = centerX + (side === 'right' ? offset : -offset);
                        bird.targetY = centerY;
                        // 从画面外飞入
                        bird.x = side === 'right' ? this.width + 80 : -80;
                        bird.y = centerY;
                        bird.state = 'enter';
                        bird.frameIndex = 0;
                        bird.frameTimer = 0;
                        bird.stayTimer = 0;
                        bird.deadTimer = 0;
                        bird.active = true;
                        bird.spawnTimer = 0;
                        bird.spawnInterval = 600 + Math.floor(Math.random() * 300); // 10-15 秒
                        // 播放鸟出现音效
                        this.playBirdSound();
                    } else {
                        // 未满足角度条件，下次再尝试
                        bird.spawnTimer = 0;
                        bird.spawnInterval = 300 + Math.floor(Math.random() * 300); // 5-10 秒后再试
                    }
                }
            }
            return;
        }

        // 帧动画
        bird.frameTimer++;
        if (bird.frameTimer >= 4) {
            bird.frameTimer = 0;
            bird.frameIndex = (bird.frameIndex + 1) % this.images.birdFrames.length;
        }

        // 状态机
        if (bird.state === 'enter') {
            // 从画面外飞向目标点
            const dx = bird.targetX - bird.x;
            const dy = bird.targetY - bird.y;
            const dist = Math.hypot(dx, dy) || 1;
            const speed = 8;
            if (dist <= speed) {
                bird.x = bird.targetX;
                bird.y = bird.targetY;
                bird.state = 'stay';
                bird.stayTimer = 0;
            } else {
                bird.x += (dx / dist) * speed;
                bird.y += (dy / dist) * speed;
            }
        } else if (bird.state === 'stay') {
            bird.stayTimer++;
            // 停留 6 秒后，如果还活着则开始攻击玩家
            if (bird.stayTimer >= 360) {
                bird.state = 'attack';
            }
        } else if (bird.state === 'attack') {
            // 朝玩家位置飞去
            const targetX = this.balancePivot.x;
            const targetY = this.balancePivot.y - 260; // 角色头部附近
            const dx = targetX - bird.x;
            const dy = targetY - bird.y;
            const dist = Math.hypot(dx, dy) || 1;
            const speed = 10;
            if (dist <= speed) {
                bird.x = targetX;
                bird.y = targetY;
                // 击中玩家
                this.onBirdHitPlayer();
                bird.active = false;
                bird.state = 'idle';
                bird.spawnTimer = 0;
                // 关卡4：攻击玩家后2-4秒随机生成下一只（120-240帧）
                if (this.tutorialMode && this.currentTutorialLevel === 4) {
                    bird.spawnInterval = 120 + Math.floor(Math.random() * 120); // 2-4秒随机
                } else {
                    bird.spawnInterval = 600 + Math.floor(Math.random() * 300); // 10-15 秒后再次尝试
                }
            } else {
                bird.x += (dx / dist) * speed;
                bird.y += (dy / dist) * speed;
            }
        } else if (bird.state === 'dead') {
            bird.deadTimer++;
            // 击中仅做"被击中"表达，快速消失：约0.2秒
            if (bird.deadTimer >= 12) { // 12帧 ≈ 0.2秒
                bird.active = false;
                bird.state = 'idle';
                bird.spawnTimer = 0;
                // 关卡4：被击中后2-4秒随机生成下一只（120-240帧）
                if (this.tutorialMode && this.currentTutorialLevel === 4) {
                    bird.spawnInterval = 120 + Math.floor(Math.random() * 120); // 2-4秒随机
                } else {
                    bird.spawnInterval = 600 + Math.floor(Math.random() * 300);
                }
            }
        }
    }

    // 玩家子弹更新（用于击落机械鸟）
    updatePlayerBullets() {
        if (!this.playerBullets || this.playerBullets.length === 0) return;
        const bird = this.mechanicalBird;
        for (let i = this.playerBullets.length - 1; i >= 0; i--) {
            const b = this.playerBullets[i];
            // 按自身速度沿平衡杆方向飞行
            b.x += b.vx || 0;
            b.y += b.vy || 0;
            // 超出屏幕范围则删除
            if (b.x < -100 || b.x > this.width + 100 || b.y < -100 || b.y > this.height + 100) {
                this.playerBullets.splice(i, 1);
                continue;
            }
            // 与机械鸟碰撞（仅在鸟处于 enter/stay 阶段时可以被击中）
            if (bird.active && (bird.state === 'enter' || bird.state === 'stay')) {
                const dx = b.x - bird.x;
                const dy = b.y - bird.y;
                const dist = Math.hypot(dx, dy);
                const hitRadius = 70; // 简单碰撞半径
                if (dist <= b.radius + hitRadius) {
                    // 击中机械鸟
                    this.playerBullets.splice(i, 1);
                    bird.state = 'dead';
                    bird.deadTimer = 0;
                    // 关卡4：增加击中计数
                    if (this.tutorialMode && this.currentTutorialLevel === 4) {
                        this.tutorialLevel4BirdsKilled++;
                    }
                    // 停止鸟出现音效
                    this.stopBirdSound();
                    return;
                }
            }
        }
    }

    // 生命恢复：每30秒恢复一点血
    updateHealthRegen() {
        // 检测回血（血量增加）
        if (this.playerHealth > this.lastHealth) {
            // 记录回血前的血量比例
            this.healStartRatio = Math.max(0, Math.min(1, this.lastHealth / this.playerMaxHealth));
            this.healAnimationTimer = this.healAnimationDuration;
        }
        // 如果血量减少，清除回血动画
        if (this.playerHealth < this.lastHealth) {
            this.healAnimationTimer = 0;
        }
        this.lastHealth = this.playerHealth;
        
        if (this.playerHealth >= this.playerMaxHealth) {
            return;
        }
        this.healthRegenTimer++;
        const regenFrames = 30 * 60; // 30秒
        if (this.healthRegenTimer >= regenFrames) {
            this.playerHealth = Math.min(this.playerMaxHealth, this.playerHealth + 1);
            this.healthRegenTimer = 0;
        }
    }

    updateBalanceRod() {
        // 关卡1：禁用平衡杆控制
        if (this.tutorialMode && this.currentTutorialLevel === 1) {
            return;
        }
        // 关卡2：使用固定速度，便于玩家操作
        let currentExtendSpeed;
        if (this.tutorialMode && this.currentTutorialLevel === 2) {
            currentExtendSpeed = 2.5; // 固定速度
        } else {
            // 根据距离动态计算平衡杆伸缩速度（整体提升1.2倍）
            if (this.distance < 250) {
                // 0-250m：速度从1.7到2（提升1.2倍）
                const progress = this.distance / 250;
                currentExtendSpeed = (1.7 + progress * 0.3) * 1.2; // 从2.04增加到2.4
            } else if (this.distance < 2000) {
                // 250-2000m：速度从2到3（提升1.2倍）
                const progress = (this.distance - 250) / (2000 - 250);
                currentExtendSpeed = (2 + progress * 1) * 1.2; // 从2.4增加到3.6
            } else if (this.distance < 2500) {
                // 2000-2500m：速度从3到5（提升1.2倍后继续增加到8）
                const progress = (this.distance - 2000) / (2500 - 2000);
                currentExtendSpeed = 3.6 + progress * 4.4; // 从3.6增加到8
            } else {
                // 2500m以上：保持速度8（从6提升到8）
                currentExtendSpeed = 8;
            }
        }
        
        if (this.keys['KeyZ'] || this.keys['KeyX']) {
            if (this.keys['KeyZ']) {
                this.balanceRod.length = Math.min(this.balanceRod.maxLength, this.balanceRod.length + currentExtendSpeed);
            }
            if (this.keys['KeyX']) {
                this.balanceRod.length = Math.max(this.balanceRod.minLength, this.balanceRod.length - currentExtendSpeed);
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
        const baseScale = 0.08; // 基础缩放（减小）
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
            spawnFrame: this.gameFrameCount, // 记录生成时的游戏帧数（用于时间计算，不受暂停影响）
            currentAngle: 30 // 初始化当前角度为30度
        });
    }


    spawnPowerUp() {
        // 关卡4：不生成任何道具
        if (this.tutorialMode && this.currentTutorialLevel === 4) {
            return;
        }
        let type;
        // 关卡2：只生成加速和减速道具
        if (this.tutorialMode && this.currentTutorialLevel === 2) {
            const types = ['speed', 'slow'];
            type = types[Math.floor(Math.random() * types.length)];
        } else if (this.tutorialMode && this.currentTutorialLevel === 3) {
            // 关卡3：只生成平衡、失衡、炸弹道具
            // 如果还没生成过炸弹道具，强制生成炸弹
            if (!this.tutorialLevel3BombSpawned) {
                type = 'explosion';
                this.tutorialLevel3BombSpawned = true;
            } else {
                // 炸弹出现频率：平衡、失衡、炸弹各占33.3%
                const rand = Math.random();
                if (rand < 0.333) {
                    type = 'balance';
                } else if (rand < 0.666) {
                    type = 'unbalance';
                } else {
                    type = 'explosion';
                }
            }
        } else {
            // 正常模式：调整道具概率：炸弹频率降低（约 1/12）
            const types = [
                'speed', 'balance', 'slow', 'unbalance',
                'speed', 'slow', 'unbalance',
                'speed', 'slow', 'balance', 'unbalance',
                'explosion'
            ];
            type = types[Math.floor(Math.random() * types.length)];
        }
        const tightropeX = this.balancePivot.x;
        const minDistance = this.balanceRod.minLength + 50; // 平衡杆最短+50像素
        const maxDistance = this.balanceRod.maxLength; // 平衡杆最长
        const side = Math.random() < 0.5 ? -1 : 1;
        let distance;
        // 关卡3的炸弹生成位置逻辑
        if (this.tutorialMode && this.currentTutorialLevel === 3 && type === 'explosion') {
            // 如果这是第一个炸弹（生成前activeBombCount为0），生成在最内侧
            if (this.activeBombCount === 0) {
                distance = minDistance; // 最内侧（最小距离）
            } else {
                // 后续炸弹正常随机生成
                distance = minDistance + Math.random() * (maxDistance - minDistance);
            }
        } else {
            distance = minDistance + Math.random() * (maxDistance - minDistance);
        }
        const x = tightropeX + (side * distance);
        this.powerUps.push({ x, y: -50, type, size: 20, collected: false });
        // 如果是炸弹道具，增加计数，并在第一个炸弹出现时播放引线音效
        if (type === 'explosion') {
            this.activeBombCount++;
            if (this.activeBombCount === 1) {
                this.playBombFuseSound();
            }
        }
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
        // 炸弹走单独流程：不播放合成音、不显示“爆炸!”文字
        if (powerUp.type !== 'explosion') {
            this.playSound(powerUp.type);
            this.showPowerUpEffect(powerUp);
        }
        if (this.hasActivePowerUp('balance') && (powerUp.type === 'unbalance' || powerUp.type === 'slow')) {
            this.clearBalanceEffect();
        }
        // 绝对平衡（balance）持续时间：3秒，其间恢复原有“完全绝对平衡”机制，
        // 但在3秒内如果玩家左右按键累计达到3次，则提前结束绝对平衡
        const activePowerUp = { type: powerUp.type, duration: powerUp.type === 'balance' ? 180 : 300, originalValue: null };
        if (powerUp.type === 'explosion') {
            // 一旦发生碰撞，进入绝处逢生阶段（引线音效是否停止由炸弹计数统一管理）
            this.triggerBombRescue();
            return;
        } else if (powerUp.type === 'speed') {
            this.speed += 0.05; // 直接增加速度，支持叠加
        } else if (powerUp.type === 'balance') {
            // 恢复原有绝对平衡机制：瞬间回正并在持续时间内免疫左右输入
            this.player.sway = 0; 
            this.player.swaySpeed = 0;
            if (!this.hasActivePowerUp('balance')) {
                activePowerUp.originalValue = 0.95; 
                activePowerUp.immuneToInput = true; 
                activePowerUp.balanceRestore = true;
                this.balanceInputBreakCount = 0; // 新一轮绝对平衡重置计数
            } else {
                const existingBalance = this.activePowerUps.find(p => p.type === 'balance');
                existingBalance.duration = 180;
                this.balanceInputBreakCount = 0;
            }
        } else if (powerUp.type === 'slow') {
            this.speed -= 0.03; // 直接减少速度，支持叠加
        } else if (powerUp.type === 'unbalance') {
            const unbalanceOffset = powerUp.x > this.tightrope.x ? 20 : -20; // 改为一次性偏移20度
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

    // 炸弹引线音效：在炸弹出现时播放，使用 Bomb fuse.mp3，持续到炸弹通过主角
    playBombFuseSound() {
        try {
            if (this.audio.bombFuse) {
                this.audio.bombFuse.currentTime = 0;
                this.audio.bombFuse.play().catch(() => {});
            }
        } catch (e) {}
    }

    stopBombFuseSound() {
        try {
            if (this.audio.bombFuse) {
                this.audio.bombFuse.pause();
                this.audio.bombFuse.currentTime = 0;
            }
        } catch (e) {}
    }

    // 炸弹爆炸音效：失败时播放 bomb.MP3
    playBombExplosionSound() {
        try {
            if (this.audio.bombExplosion) {
                this.audio.bombExplosion.currentTime = 0;
                this.audio.bombExplosion.playbackRate = 1.0;
                this.audio.bombExplosion.play().catch(() => {});
            }
        } catch (e) {}
    }

    // 鸟出现音效：播放 bird.MP3
    playBirdSound() {
        try {
            if (this.audio.birdSound) {
                this.audio.birdSound.currentTime = 0;
                this.audio.birdSound.play().catch(() => {});
            }
        } catch (e) {}
    }

    // 停止鸟出现音效
    stopBirdSound() {
        try {
            if (this.audio.birdSound) {
                this.audio.birdSound.pause();
                this.audio.birdSound.currentTime = 0;
            }
        } catch (e) {}
    }

    // 光束发射音效：播放 biu.MP3
    playBulletSound() {
        try {
            if (this.audio.bulletSound) {
                this.audio.bulletSound.currentTime = 0;
                this.audio.bulletSound.play().catch(() => {});
            }
        } catch (e) {}
    }

    // 受伤音效：播放 hurt.MP3
    playHurtSound() {
        try {
            if (this.audio.hurtSound) {
                this.audio.hurtSound.currentTime = 0;
                this.audio.hurtSound.play().catch(() => {});
            }
        } catch (e) {}
    }

    // 触发炸弹Q键救援阶段
    triggerBombRescue() {
        this.bombRescue.active = true;
        this.bombRescue.timer = 0;
        this.bombRescue.resolved = false;
        // 记录接触炸弹时的角度
        this.bombRescue.contactAngle = Math.abs(this.player.sway);
        // 随机选择救援按键：Q、W、E、A、S、D
        const rescueKeys = ['KeyQ', 'KeyW', 'KeyE', 'KeyA', 'KeyS', 'KeyD'];
        this.bombRescue.rescueKey = rescueKeys[Math.floor(Math.random() * rescueKeys.length)];
    }

    // 更新炸弹救援计时
    updateBombRescue() {
        if (!this.bombRescue.active) return;
        this.bombRescue.timer++;
        if (this.bombRescue.timer >= this.bombRescue.duration && !this.bombRescue.resolved) {
            // 超时且未成功，判定失败
            this.handleBombRescueFail();
        }
    }

    // 炸弹救援成功：绝处逢生一次，继续游戏（无保护罩）
    handleBombRescueSuccess() {
        if (!this.bombRescue.active || this.bombRescue.resolved) return;
        this.bombRescue.resolved = true;
        this.bombRescue.active = false;
        this.bombRescue.timer = 0;
        // 如果接触炸弹时角度超过40度，自动回归0度平衡状态
        if (this.bombRescue.contactAngle > 40) {
            this.player.sway = 0;
            this.player.swaySpeed = 0;
        }
        // 启动护罩动画，与金色文字同时出现、同时淡出
        this.bombRescueShield.active = true;
        this.bombRescueShield.timer = 0;
        // 播放上扬的绝处逢生音乐
        this.playBombRescueSuccessSound();
        this.showBombRescueSuccessEffect(); // 仅保留金色文字，不再有画布动画
    }

    // 炸弹救援失败：播放爆炸音效并结束游戏
    handleBombRescueFail() {
        if (!this.bombRescue.active || this.bombRescue.resolved) return;
        this.bombRescue.resolved = true;
        this.bombRescue.active = false;
        this.bombRescue.timer = 0;
        this.playBombExplosionSound();
        // 延迟调用结束界面，确保炸弹音效能播放
        setTimeout(() => {
            // 教程模式下使用新手关卡结束界面，否则使用正常游戏结束界面
            if (this.tutorialMode) {
                // 如果已经通关，即使炸弹爆炸也显示成功
                if (this.tutorialLevelCompleted) {
                    this.endTutorialLevel(true);
                } else {
                    this.endTutorialLevel(false);
                }
            } else {
                this.gameOver();
            }
        }, 100); // 延迟100ms，让音效开始播放
    }

    // 绝处逢生视觉反馈：金色文字，上浮+透明度降低，和吃到好道具动画一致，但整体上移200像素
    showBombRescueSuccessEffect() {
        const effectText = document.createElement('div');
        effectText.style.position = 'absolute';
        effectText.style.left = '50%';
        effectText.style.top = '60%';
        // 整体上移200像素（在原有动画基础上整体偏移）
        effectText.style.transform = 'translateX(-50%) translateY(-150px)';
        // 金色大字"绝处逢生"（响应式设计）
        effectText.style.color = '#FFD700';
        // 根据视口宽度计算字体大小：基础60px，按视口宽度缩放
        const baseFontSize = 60;
        const viewportWidth = window.innerWidth;
        const scaleFactor = Math.min(viewportWidth / 1920, 1.5); // 以1920px为基准，最大1.5倍
        const fontSize = Math.max(baseFontSize * scaleFactor, baseFontSize * 0.6); // 最小为基准的60%
        effectText.style.fontSize = fontSize + 'px';
        effectText.style.fontWeight = 'bold';
        effectText.style.pointerEvents = 'none';
        effectText.style.zIndex = '1200';
        effectText.style.textAlign = 'center';
        // 文字阴影也根据字体大小缩放
        const shadowBlur = 18 * (fontSize / baseFontSize);
        effectText.style.textShadow = `0 0 ${shadowBlur}px rgba(255,215,0,0.95)`;
        effectText.textContent = '绝处逢生！';
        document.body.appendChild(effectText);
        let opacity = 1; let y = 60;
        const animate = () => {
            opacity -= 0.015; y -= 0.5;
            effectText.style.opacity = opacity;
            effectText.style.top = y + '%';
            if (opacity > 0) requestAnimationFrame(animate); else document.body.removeChild(effectText);
        };
        animate();
    }

    // 绝处逢生成功时的上扬音乐（Web Audio合成，避免加载额外文件）
    playBombRescueSuccessSound() {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            const ctx = new AudioCtx();
            const now = ctx.currentTime;
            const notes = [880, 1174, 1568]; // A5-C#6-G6 上扬三音
            notes.forEach((freq, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.frequency.value = freq;
                osc.type = 'sine';
                osc.connect(gain);
                gain.connect(ctx.destination);
                const start = now + i * 0.08;
                const end = start + 0.25;
                gain.gain.setValueAtTime(0.0, start);
                gain.gain.linearRampToValueAtTime(0.25, start + 0.05);
                gain.gain.linearRampToValueAtTime(0.0, end);
                osc.start(start);
                osc.stop(end + 0.02);
            });
        } catch (e) {}
    }

    // 绝处逢生护罩动画的更新
    updateBombRescueShield() {
        if (!this.bombRescueShield.active) return;
        this.bombRescueShield.timer++;
        if (this.bombRescueShield.timer >= this.bombRescueShield.duration) {
            this.bombRescueShield.active = false;
        }
    }

    // 机械鸟攻击命中玩家时调用：玩家闪红并扣血
    onBirdHitPlayer() {
        if (this.playerHealth <= 0) return;
        this.playerHealth = Math.max(0, this.playerHealth - 1);
        this.healthRegenTimer = 0;
        this.damageFlashTimer = 40; // 闪烁一小段时间
        // 播放受伤音效
        this.playHurtSound();
        if (this.playerHealth <= 0) {
            this.gameOver();
        }
    }


    showPowerUpEffect(powerUp) {
        const effectText = document.createElement('div');
        effectText.style.position = 'absolute';
        effectText.style.left = '50%';
        effectText.style.top = '60%';
        effectText.style.transform = 'translateX(-50%)';
        effectText.style.color = this.getPowerUpColor(powerUp.type);
        // 响应式设计：根据视口宽度计算字体大小
        const baseFontSize = 40;
        const viewportWidth = window.innerWidth;
        const scaleFactor = Math.min(viewportWidth / 1920, 1.5); // 以1920px为基准，最大1.5倍
        const fontSize = Math.max(baseFontSize * scaleFactor, baseFontSize * 0.6); // 最小为基准的60%
        effectText.style.fontSize = fontSize + 'px';
        effectText.style.fontWeight = 'bold';
        effectText.style.pointerEvents = 'none';
        effectText.style.zIndex = '1000';
        effectText.style.textAlign = 'center';
        // 文字阴影也根据字体大小缩放
        const shadowOffset = 2 * (fontSize / baseFontSize);
        const shadowBlur = 4 * (fontSize / baseFontSize);
        effectText.style.textShadow = `${shadowOffset}px ${shadowOffset}px ${shadowBlur}px rgba(0,0,0,0.8)`;
        effectText.textContent = this.getPowerUpText(powerUp.type);
        document.body.appendChild(effectText);
        let opacity = 1; let y = 60;
        const animate = () => {
            opacity -= 0.015; y -= 0.5; effectText.style.opacity = opacity; effectText.style.top = y + '%';
            if (opacity > 0) requestAnimationFrame(animate); else document.body.removeChild(effectText);
        };
        animate();
    }

        // 机械鸟绘制（包含左右镜像）
    drawMechanicalBird() {
        const bird = this.mechanicalBird;
        if (!bird.active || !this.images.birdFrames || this.images.birdFrames.length === 0) return;
        const frame = this.images.birdFrames[bird.frameIndex % this.images.birdFrames.length];
        if (!frame) return;
        const x = bird.x;
        const y = bird.y;
        const imgW = frame.naturalWidth || frame.width || 0;
        const imgH = frame.naturalHeight || frame.height || 0;
        if (!imgW || !imgH) return;
        // 缩放系数设为1，使用原始图片尺寸
        const scale = 1;
        const drawW = imgW * scale;
        const drawH = imgH * scale;

        this.ctx.save();
        this.ctx.translate(x, y);
        if (bird.side === 'right') {
            // 右侧时水平镜像
            this.ctx.scale(-1, 1);
        }
        // 死亡闪烁：dead 状态下交替透明
        if (bird.state === 'dead' && (bird.deadTimer % 6 < 3)) {
            this.ctx.globalAlpha = 0.2;
        }
        this.ctx.drawImage(frame, -drawW / 2, -drawH / 2, drawW, drawH);
        this.ctx.restore();
    }

    drawPlayerBullets() {
        if (!this.playerBullets || this.playerBullets.length === 0) return;
        this.ctx.save();
        for (const b of this.playerBullets) {
            const angle = b.angle !== undefined ? b.angle : Math.atan2(b.vy, b.vx);
            const length = b.length !== undefined ? b.length : 30;
            const width = 16; // 激光光束宽度（原来4的4倍）
            
            // 计算激光光束的起点和终点
            const halfLength = length / 2;
            const startX = b.x - Math.cos(angle) * halfLength;
            const startY = b.y - Math.sin(angle) * halfLength;
            const endX = b.x + Math.cos(angle) * halfLength;
            const endY = b.y + Math.sin(angle) * halfLength;
            
            // 绘制发光外圈（较暗，较粗）
            this.ctx.strokeStyle = 'rgba(255, 215, 0, 0.4)';
            this.ctx.lineWidth = width + 8;
            this.ctx.lineCap = 'round';
            this.ctx.beginPath();
            this.ctx.moveTo(startX, startY);
            this.ctx.lineTo(endX, endY);
            this.ctx.stroke();
            
            // 绘制主光束（亮金色，渐变效果）
            const gradient = this.ctx.createLinearGradient(startX, startY, endX, endY);
            gradient.addColorStop(0, 'rgba(255, 215, 0, 0.8)');
            gradient.addColorStop(0.5, 'rgba(255, 255, 100, 1.0)');
            gradient.addColorStop(1, 'rgba(255, 215, 0, 0.8)');
            this.ctx.strokeStyle = gradient;
            this.ctx.lineWidth = width;
            this.ctx.lineCap = 'round';
            this.ctx.beginPath();
            this.ctx.moveTo(startX, startY);
            this.ctx.lineTo(endX, endY);
            this.ctx.stroke();
            
            // 绘制核心高光（最亮，最细）
            this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.moveTo(startX, startY);
            this.ctx.lineTo(endX, endY);
            this.ctx.stroke();
        }
        this.ctx.restore();
    }

    drawHealthBar() {
        // 暂时禁用血条显示，代码保留以便后期重用
        return;
        
        const maxHP = this.playerMaxHealth;
        const hp = this.playerHealth;
        if (!maxHP) return;
        // 宽度缩小为70%
        const barWidth = 70;
        const barHeight = 7; // 高度变为7像素
        const ratio = Math.max(0, Math.min(1, hp / maxHP));

        // 以balancePivot为旋转中心，在人物头顶上方350像素的位置（上移50像素），右移10像素
        const offsetY = -350; // 向上350像素（相对于旋转中心，上移了50像素）
        const offsetX = 10; // 右移10像素（从20改为10，相当于左移10像素）
        
        this.ctx.save();
        // 移动到旋转中心并旋转
        this.ctx.translate(this.balancePivot.x, this.balancePivot.y);
        this.ctx.rotate(this.player.sway * Math.PI / 180);
        
        // 在局部坐标系中绘制血条（相对于旋转中心，向上350像素，右移20像素）
        const localX = -barWidth / 2 + offsetX; // 水平居中后右移20像素
        const localY = offsetY; // 向上350像素
        const radius = barHeight / 2; // 圆角半径（半圆端点）
        
        // 更新回血动画计时
        if (this.healAnimationTimer > 0) {
            this.healAnimationTimer--;
        }
        
        // 绘制圆角矩形的辅助函数
        const drawRoundedRect = (x, y, width, height, radius) => {
            this.ctx.beginPath();
            this.ctx.moveTo(x + radius, y);
            this.ctx.lineTo(x + width - radius, y);
            this.ctx.arc(x + width - radius, y + radius, radius, -Math.PI / 2, 0);
            this.ctx.lineTo(x + width, y + height - radius);
            this.ctx.arc(x + width - radius, y + height - radius, radius, 0, Math.PI / 2);
            this.ctx.lineTo(x + radius, y + height);
            this.ctx.arc(x + radius, y + height - radius, radius, Math.PI / 2, Math.PI);
            this.ctx.lineTo(x, y + radius);
            this.ctx.arc(x + radius, y + radius, radius, Math.PI, -Math.PI / 2);
            this.ctx.closePath();
        };
        
        // 背景条（深色）
        this.ctx.fillStyle = 'rgba(40, 40, 40, 0.8)';
        drawRoundedRect(localX, localY, barWidth, barHeight, radius);
        this.ctx.fill();

        // 金色血量条
        const fillW = barWidth * ratio;
        if (fillW > 0) {
            this.ctx.fillStyle = '#FFD700'; // 金色
            // 如果血量不满，需要绘制部分圆角矩形
            if (fillW < barWidth) {
                // 绘制部分圆角矩形（左端圆角，右端直角）
                this.ctx.beginPath();
                this.ctx.moveTo(localX + radius, localY);
                this.ctx.lineTo(localX + fillW, localY);
                this.ctx.lineTo(localX + fillW, localY + barHeight);
                this.ctx.lineTo(localX + radius, localY + barHeight);
                this.ctx.arc(localX + radius, localY + radius, radius, Math.PI / 2, -Math.PI / 2, true);
                this.ctx.closePath();
                this.ctx.fill();
            } else {
                // 满血时绘制完整圆角矩形
                drawRoundedRect(localX, localY, fillW, barHeight, radius);
                this.ctx.fill();
            }
        }
        
        // 空血条（深红色）- 只绘制在血量条之后的部分
        if (fillW < barWidth) {
            const emptyW = barWidth - fillW;
            this.ctx.fillStyle = 'rgba(80, 20, 20, 0.6)';
            // 绘制右端圆角的空血条部分
            if (fillW > 0) {
                // 如果左边有血量，右边绘制直角矩形
                this.ctx.fillRect(localX + fillW, localY, emptyW, barHeight);
            } else {
                // 如果完全没有血量，绘制完整圆角矩形
                drawRoundedRect(localX, localY, barWidth, barHeight, radius);
                this.ctx.fill();
            }
        }

        // 回血增长动画（半透明）- 只在血量增加时显示
        if (this.healAnimationTimer > 0 && ratio > this.healStartRatio) {
            const animationProgress = 1 - (this.healAnimationTimer / this.healAnimationDuration);
            const lastFillW = barWidth * this.healStartRatio; // 回血前的宽度
            const currentFillW = barWidth * ratio; // 当前血量宽度
            const animFillW = lastFillW + (currentFillW - lastFillW) * animationProgress;
            
            if (animFillW > lastFillW && animFillW > 0) {
                this.ctx.globalAlpha = 0.5 * (1 - animationProgress); // 逐渐淡出
                this.ctx.fillStyle = '#FFD700'; // 金色
                // 绘制增长部分（从lastFillW到animFillW）
                if (animFillW < barWidth) {
                    // 增长部分未到右端，绘制矩形
                    this.ctx.beginPath();
                    this.ctx.moveTo(localX + lastFillW, localY);
                    this.ctx.lineTo(localX + animFillW, localY);
                    this.ctx.lineTo(localX + animFillW, localY + barHeight);
                    this.ctx.lineTo(localX + lastFillW, localY + barHeight);
                    this.ctx.closePath();
                    this.ctx.fill();
                } else {
                    // 增长部分到达右端，需要绘制圆角
                    this.ctx.beginPath();
                    this.ctx.moveTo(localX + lastFillW, localY);
                    this.ctx.lineTo(localX + barWidth - radius, localY);
                    this.ctx.arc(localX + barWidth - radius, localY + radius, radius, -Math.PI / 2, 0);
                    this.ctx.lineTo(localX + barWidth, localY + barHeight - radius);
                    this.ctx.arc(localX + barWidth - radius, localY + barHeight - radius, radius, 0, Math.PI / 2);
                    this.ctx.lineTo(localX + lastFillW, localY + barHeight);
                    this.ctx.closePath();
                    this.ctx.fill();
                }
                this.ctx.globalAlpha = 1.0; // 恢复不透明度
            }
        }

        // 边框（白色）
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        this.ctx.lineWidth = 1;
        drawRoundedRect(localX, localY, barWidth, barHeight, radius);
        this.ctx.stroke();

        this.ctx.restore();
    }

    drawHeartLives() {
        const maxHP = this.playerMaxHealth;
        const hp = this.playerHealth;
        if (!maxHP) return;
        
        // 心形大小和间距
        const heartSize = 40; // 心形大小
        const heartSpacing = -5; // 心形之间的间距（负值表示重叠，更紧凑）
        // 进度条：中心416px，宽度600px，左边界116px，右边界716px
        const progressBarLeft = 116; // 进度条左边界
        const progressBarRight = 716; // 进度条右边界
        const spacing = 10; // 与进度条的间距
        const heartTotalWidth = maxHP * heartSize + (maxHP - 1) * heartSpacing; // 动态计算总宽度
        
        // 计算左边可用空间和右边可用空间
        const leftSpace = progressBarLeft; // 左边可用空间：0到116px
        const rightSpace = this.width - progressBarRight; // 右边可用空间：716px到832px = 116px
        
        // 优先放在空间更大的一边，确保不重叠
        let startX;
        if (leftSpace >= heartTotalWidth + spacing) {
            // 左边空间足够，放在进度条左边
            startX = progressBarLeft - heartTotalWidth - spacing;
        } else if (rightSpace >= heartTotalWidth + spacing) {
            // 右边空间足够，放在进度条右边
            startX = progressBarRight + spacing;
        } else {
            // 两边空间都不够，放在左边，紧贴画布左边界，减小间距避免重叠
            startX = 10; // 留10px边距
            // 如果会与进度条重叠，调整到刚好不重叠的位置
            if (startX + heartTotalWidth > progressBarLeft - spacing) {
                startX = Math.max(10, progressBarLeft - heartTotalWidth - 5); // 至少留5px间距
            }
        }
        
        const y = 15; // 上移55像素（从70改为15）
        
        this.ctx.save();
        
        // 绘制心形的辅助函数
        const drawHeart = (x, y, size, color, alpha = 1.0) => {
            this.ctx.save();
            this.ctx.globalAlpha = alpha;
            this.ctx.fillStyle = color;
            this.ctx.beginPath();
            // 绘制心形路径（标准心形）
            const scale = size / 24; // 标准化大小（基于24像素基准）
            // 从顶部中心点开始
            this.ctx.moveTo(x, y - 2 * scale);
            // 左上方圆弧
            this.ctx.bezierCurveTo(x, y - 6 * scale, x - 6 * scale, y - 6 * scale, x - 6 * scale, y);
            // 左下方
            this.ctx.bezierCurveTo(x - 6 * scale, y + 3 * scale, x, y + 6 * scale, x, y + 8 * scale);
            // 右下方
            this.ctx.bezierCurveTo(x, y + 6 * scale, x + 6 * scale, y + 3 * scale, x + 6 * scale, y);
            // 右上方圆弧
            this.ctx.bezierCurveTo(x + 6 * scale, y - 6 * scale, x, y - 6 * scale, x, y - 2 * scale);
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.restore();
        };
        
        // 从左到右绘制心形（右边先消失）
        for (let i = 0; i < maxHP; i++) {
            const heartX = startX + i * (heartSize + heartSpacing);
            
            if (i < hp) {
                // 有生命值，绘制金色心形
                drawHeart(heartX + heartSize / 2, y + heartSize / 2, heartSize, '#FFD700', 1.0);
            } else {
                // 失去生命值，绘制灰色半透明心形
                drawHeart(heartX + heartSize / 2, y + heartSize / 2, heartSize, '#808080', 0.5);
            }
        }
        
        this.ctx.restore();
    }

    drawDamageFlash() {
        if (this.damageFlashTimer <= 0) return;
        this.damageFlashTimer--;
        // 前20帧内闪两下
        const t = this.damageFlashTimer;
        const flash = (t % 10) < 5;
        if (!flash) return;
        this.ctx.save();
        this.ctx.fillStyle = 'rgba(255,0,0,0.25)';
        this.ctx.fillRect(0, 0, this.width, this.height);
        this.ctx.restore();
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
        // 初始化动态背景时，清空旧元素，分别在左右各生成一个，避免重叠
        this.landscape = [];
        this.leftSpawnTimer = 0;
        this.rightSpawnTimer = 0;
        this.spawnLandscapeElement('left');
        this.spawnLandscapeElement('right');
    }


    checkGameOver() {
        // 新手教学模式：使用不同的失败检测
        if (this.tutorialMode) {
            // 教程模式下，失败条件仍然是60度
            if (Math.abs(this.player.sway) >= 60) {
                // 如果已经通关（达到目标距离），即使掉落也显示成功
                if (this.tutorialLevelCompleted) {
                    this.endTutorialLevel(true);
                } else {
                    // 设置失败原因为坠落
                    if (this.currentTutorialLevel === 2) {
                        this.tutorialLevel2FailReason = 'fall';
                    } else if (this.currentTutorialLevel === 3) {
                        this.tutorialLevel3FailReason = 'fall';
                    }
                    this.endTutorialLevel(false);
                }
                return;
            }
            return;
        }
        const absSway = Math.abs(this.player.sway);
        
        // 如果超过死亡阈值，立即死亡
        if (absSway >= this.deathThreshold) {
            this.gameOver();
            return;
        }
        
        // 如果超过危险阈值，开始计时
        if (absSway >= this.dangerThreshold) {
            this.dangerZoneTimer++;
            // 如果超过垂死挣扎时间，游戏结束
            if (this.dangerZoneTimer >= this.dangerZoneDuration) {
                this.gameOver();
            }
        } else {
            // 如果回到安全区域，重置计时器
            this.dangerZoneTimer = 0;
        }
    }

    gameOver() {
        this.gameRunning = false;
        // 确保任意死亡（包括角度过大）时，立即停止炸弹引线音效
        this.stopBombFuseSound();
        // 停止所有游戏内音效
        this.stopAllSounds();
        const finalScore = Math.floor(this.distance);
        document.getElementById('finalDistance').textContent = finalScore;
        
        // 检查是否超过最远距离
        const isNewRecord = finalScore > this.highScore;
        const previousHighScore = this.highScore; // 保存之前的最高分
        
        // 更新最高分（多用户系统）
        if (isNewRecord) {
            this.updateUserScore(finalScore);
            // 播放新纪录音效
            this.playNewRecordSound();
            // 更新排行榜显示和进度条标记
            this.renderLeaderboard();
            this.updateProgressBarMarkers();
        } else {
            // 播放游戏结束音效
            this.playGameOverSound();
        }
        
        // 根据是否创造新纪录显示不同信息
        const titleElement = document.getElementById('gameOverTitle');
        const messageElement = document.getElementById('gameOverMessage');
        
        if (isNewRecord) {
            // 破纪录时显示成功图片
            const imgSrc = (this.images.end_success && this.images.end_success.complete) 
                ? this.images.end_success.src 
                : 'image/end_success.jpg';
            titleElement.innerHTML = `<img src="${imgSrc}" alt="新纪录" style="width: 100%; height: auto; display: block; margin: 0 auto;">`;
            titleElement.style.background = 'none';
            titleElement.style.backgroundImage = 'none';
            titleElement.style.width = '100%';
            titleElement.style.height = 'auto';
            titleElement.style.minHeight = '150px';
            titleElement.style.textIndent = '0';
            titleElement.classList.add('new-record', 'has-image');
            messageElement.innerHTML = `
                <div class="current-distance-box">
                    <span class="current-distance-text" style="font-size: 1.2em;">你走了 </span><span id="finalDistance">${finalScore}</span><span class="current-distance-unit" style="font-size: 1.2em;"> m</span>
                </div>
                <div class="previous-distance-info">
                    曾经距离 <span id="bestDistanceDisplay">${previousHighScore}</span> m
                </div>
            `;
        } else {
            // 未破纪录时显示失败图片
            const imgSrc = (this.images.end_fail && this.images.end_fail.complete) 
                ? this.images.end_fail.src 
                : 'image/end_fail.jpg';
            titleElement.innerHTML = `<img src="${imgSrc}" alt="就差一点点" style="width: 100%; height: auto; display: block; margin: 0 auto;">`;
            titleElement.style.background = 'none';
            titleElement.style.backgroundImage = 'none';
            titleElement.style.width = '100%';
            titleElement.style.height = 'auto';
            titleElement.style.minHeight = '150px';
            titleElement.style.textIndent = '0';
            titleElement.classList.remove('new-record');
            titleElement.classList.add('has-image');
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
        // 渲染游戏结束页面的排行榜
        this.renderGameOverLeaderboard();
        // 停止背景音乐
        this.stopBackgroundMusic();
    }

    updateUI() {
        const currentDistance = Math.floor(this.distance);
        // 教程模式下根据关卡设置最大距离
        let maxDistance = 6666;
        if (this.tutorialMode) {
            if (this.currentTutorialLevel === 2) {
                maxDistance = 400; // 关卡2目标400m
            } else if (this.currentTutorialLevel === 3) {
                maxDistance = 400; // 关卡3目标400m
            } else if (this.currentTutorialLevel === 4) {
                maxDistance = 6666; // 关卡4没有距离要求，使用默认值
            } else {
                maxDistance = 200; // 其他关卡200m
            }
        }
        const progressPercentage = Math.min((currentDistance / maxDistance) * 100, 100);
        
        // 更新进度条（关卡4不显示进度条）
        if (this.tutorialMode && this.currentTutorialLevel === 4) {
            document.getElementById('progressFill').style.width = '0%';
        } else {
            document.getElementById('progressFill').style.width = progressPercentage + '%';
        }
        document.getElementById('currentDistanceNumber').textContent = currentDistance;
        
        // 更新最大距离显示（关卡4不显示）
        const maxDistanceEl = document.getElementById('maxDistance');
        if (maxDistanceEl) {
            if (this.tutorialMode && this.currentTutorialLevel === 4) {
                maxDistanceEl.style.display = 'none';
            } else {
                maxDistanceEl.style.display = 'block';
                maxDistanceEl.textContent = maxDistance + 'm';
            }
        }
        
        // 更新绝对平衡时间显示（只在关卡3显示，显示在距离下方，字体扩大3倍）
        // 关卡4：显示击中数
        const absoluteBalanceTimeEl = document.getElementById('absoluteBalanceTime');
        if (absoluteBalanceTimeEl) {
            if (this.tutorialMode && this.currentTutorialLevel === 3) {
                const balanceSeconds = (this.absoluteBalanceTime / 60).toFixed(1); // 转换为秒，保留1位小数
                const targetSeconds = (this.absoluteBalanceTarget / 60).toFixed(1); // 目标时间
                // 更新数字部分，S单位在HTML中已定义
                const sSpan = absoluteBalanceTimeEl.querySelector('span');
                if (sSpan) {
                    // 如果已有S的span，只更新前面的文本内容
                    const textContent = absoluteBalanceTimeEl.textContent || '';
                    const currentText = textContent.replace('S', '').trim();
                    absoluteBalanceTimeEl.innerHTML = `${balanceSeconds}/${targetSeconds}<span style="font-size: 24px; margin-left: 2px;">S</span>`;
                } else {
                    // 如果没有span，创建新的结构
                    absoluteBalanceTimeEl.innerHTML = `${balanceSeconds}/${targetSeconds}<span style="font-size: 24px; margin-left: 2px;">S</span>`;
                }
                absoluteBalanceTimeEl.style.display = 'flex';
            } else if (this.tutorialMode && this.currentTutorialLevel === 4) {
                // 关卡4：显示击中数
                absoluteBalanceTimeEl.innerHTML = `${this.tutorialLevel4BirdsKilled}/${this.tutorialLevel4BirdsTarget}`;
                absoluteBalanceTimeEl.style.display = 'flex';
            } else {
                absoluteBalanceTimeEl.style.display = 'none';
            }
        }
        
        // 更新所有玩家的标记
        this.updateProgressBarMarkers();
    }

    updateProgressBarMarkers() {
        // 教程模式下根据关卡设置最大距离
        let maxDistance = 6666;
        if (this.tutorialMode) {
            if (this.currentTutorialLevel === 2) {
                maxDistance = 400; // 关卡2目标400m
            } else if (this.currentTutorialLevel === 3) {
                maxDistance = 400; // 关卡3目标400m
            } else {
                maxDistance = 200; // 其他关卡200m
            }
        }
        const progressBar = document.getElementById('progressBar');
        
        // 清除旧的标记（除了bestDistanceLine和bestDistanceLabel）
        const oldMarkers = progressBar.querySelectorAll('.player-marker, .player-marker-label');
        oldMarkers.forEach(marker => marker.remove());
        
        // 获取所有用户，按分数排序
        const sortedUsers = [...this.users].sort((a, b) => b.highScore - a.highScore);
        
        // 只显示前5名（避免太拥挤）
        const topUsers = sortedUsers.slice(0, 5);
        
        topUsers.forEach((user, index) => {
            if (user.highScore <= 0) return;
            
            const percentage = Math.min((user.highScore / maxDistance) * 100, 100);
            const displayPercentage = Math.max(2, Math.min(98, percentage));
            
            // 创建标记线
            const marker = document.createElement('div');
            marker.className = 'player-marker';
            if (this.currentUser === user.name) {
                marker.classList.add('current-player');
            }
            marker.style.left = displayPercentage + '%';
            marker.style.zIndex = 10 + index;
            
            // 创建标签
            const label = document.createElement('div');
            label.className = 'player-marker-label';
            if (this.currentUser === user.name) {
                label.classList.add('current-player');
            }
            label.style.left = displayPercentage + '%';
            label.textContent = user.name.charAt(0) + ':' + user.highScore + 'm';
            
            progressBar.appendChild(marker);
            progressBar.appendChild(label);
        });
        
        // 更新当前玩家的最佳距离标记（如果存在）
        if (this.currentUser && this.highScore > 0) {
            const bestDistancePercentage = Math.min((this.highScore / maxDistance) * 100, 100);
            const displayPercentage = Math.max(2, bestDistancePercentage);
            const bestDistanceLine = document.getElementById('bestDistanceLine');
            const bestDistanceLabel = document.getElementById('bestDistanceLabel');
            if (bestDistanceLine) {
                bestDistanceLine.style.left = displayPercentage + '%';
            }
            if (bestDistanceLabel) {
                bestDistanceLabel.style.left = displayPercentage + '%';
                bestDistanceLabel.textContent = this.highScore + 'm';
            }
        }
    }

    render() {
        this.ctx.clearRect(0, 0, this.width, this.height);
        // 炸弹救援阶段画面变为黑白，结束后恢复彩色
        if (this.bombRescue.active) {
            this.canvas.style.filter = 'grayscale(1)';
        } else {
            this.canvas.style.filter = '';
        }
        this.drawBackground();
        this.drawDangerLines(); // 绘制危险边界线
        this.drawPlayer();
        this.drawWindIndicator();
        this.drawParticles();
        this.drawPowerUps();
        this.drawMechanicalBird();
        this.drawPlayerBullets();
        this.drawHealthBar();
        this.drawHeartLives(); // 绘制心形生命值
        this.drawDamageFlash();
        this.drawBombRescueOverlay(); // 炸弹救援提示与时间条
        this.drawTutorialLevel2Timer(); // 关卡2时间倒计时
    }

    drawTutorialLevel2Timer() {
        // 只在关卡2显示时间倒计时
        if (!this.tutorialMode || this.currentTutorialLevel !== 2) return;
        
        const timeRemaining = Math.max(0, this.tutorialLevel2TimeLimit - this.tutorialLevel2TimeElapsed);
        const secondsRemaining = Math.ceil(timeRemaining / 60);
        const minutes = Math.floor(secondsRemaining / 60);
        const seconds = secondsRemaining % 60;
        const timeText = `⏰ ${minutes}:${seconds.toString().padStart(2, '0')}`;
        
        const centerX = this.width / 2;
        const y = 40;
        const rectHeight = 35; // 减小矩形高度（从50改为35）
        const rectWidth = 160; // 增加宽度以容纳时钟图标
        
        // 绘制背景框
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        this.ctx.fillRect(centerX - rectWidth / 2, y - rectHeight / 2, rectWidth, rectHeight);
        this.ctx.strokeStyle = timeRemaining <= 600 ? '#FF0000' : '#FFD700'; // 剩余10秒内变红
        this.ctx.lineWidth = 3;
        this.ctx.strokeRect(centerX - rectWidth / 2, y - rectHeight / 2, rectWidth, rectHeight);
        
        // 绘制时间文字（包含时钟图标）
        this.ctx.fillStyle = timeRemaining <= 600 ? '#FF0000' : '#FFFFFF';
        this.ctx.font = 'bold 24px Arial'; // 减小字体（从32px改为24px）
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(timeText, centerX, y);

        // 倒计时音效：在剩余4秒、3秒、2秒、1秒时分别播放单音（精确到帧）
        if (timeRemaining === 240 && !this.tutorialLevel2TimeSoundPlayed[0]) {
            // 剩余正好4秒时播放第一个音
            this.tutorialLevel2TimeSoundPlayed[0] = true;
            this.playCountdownBeep(600);
        } else if (timeRemaining === 180 && !this.tutorialLevel2TimeSoundPlayed[1]) {
            // 剩余正好3秒时播放第二个音
            this.tutorialLevel2TimeSoundPlayed[1] = true;
            this.playCountdownBeep(600);
        } else if (timeRemaining === 120 && !this.tutorialLevel2TimeSoundPlayed[2]) {
            // 剩余正好2秒时播放第三个音
            this.tutorialLevel2TimeSoundPlayed[2] = true;
            this.playCountdownBeep(600);
        } else if (timeRemaining === 60 && !this.tutorialLevel2TimeSoundPlayed[3]) {
            // 剩余正好1秒时播放第四个音（高音）
            this.tutorialLevel2TimeSoundPlayed[3] = true;
            this.playCountdownBeep(1000, 0.3);
        }

        // 最后5秒时画面边沿出现红色警示（300帧 = 5秒）
        if (timeRemaining <= 300) {
            const edgeWidth = 37.5; // 边沿宽度（75的一半 = 37.5）
            const maxAlpha = Math.min(0.3, (300 - timeRemaining) / 300 * 0.3); // 逐渐增强，最大透明度0.3
            
            // 绘制上边沿（边沿实，中心虚）
            const topGradient = this.ctx.createLinearGradient(0, 0, 0, edgeWidth);
            topGradient.addColorStop(0, `rgba(255, 0, 0, ${maxAlpha})`); // 画面边沿（y=0）实
            topGradient.addColorStop(1, 'rgba(255, 0, 0, 0)'); // 靠近中心（y=edgeWidth）虚（透明）
            this.ctx.fillStyle = topGradient;
            this.ctx.fillRect(0, 0, this.width, edgeWidth);
            
            // 绘制下边沿（边沿实，中心虚）
            const bottomGradient = this.ctx.createLinearGradient(0, this.height - edgeWidth, 0, this.height);
            bottomGradient.addColorStop(1, `rgba(255, 0, 0, ${maxAlpha})`); // 画面边沿（y=this.height）实
            bottomGradient.addColorStop(0, 'rgba(255, 0, 0, 0)'); // 靠近中心（y=this.height-edgeWidth）虚（透明）
            this.ctx.fillStyle = bottomGradient;
            this.ctx.fillRect(0, this.height - edgeWidth, this.width, edgeWidth);
            
            // 绘制左边沿（边沿实，中心虚）
            const leftGradient = this.ctx.createLinearGradient(0, 0, edgeWidth, 0);
            leftGradient.addColorStop(0, `rgba(255, 0, 0, ${maxAlpha})`); // 画面边沿（x=0）实
            leftGradient.addColorStop(1, 'rgba(255, 0, 0, 0)'); // 靠近中心（x=edgeWidth）虚（透明）
            this.ctx.fillStyle = leftGradient;
            this.ctx.fillRect(0, 0, edgeWidth, this.height);
            
            // 绘制右边沿（边沿实，中心虚）
            const rightGradient = this.ctx.createLinearGradient(this.width - edgeWidth, 0, this.width, 0);
            rightGradient.addColorStop(1, `rgba(255, 0, 0, ${maxAlpha})`); // 画面边沿（x=this.width）实
            rightGradient.addColorStop(0, 'rgba(255, 0, 0, 0)'); // 靠近中心（x=this.width-edgeWidth）虚（透明）
            this.ctx.fillStyle = rightGradient;
            this.ctx.fillRect(this.width - edgeWidth, 0, edgeWidth, this.height);
        }
    }

    playCountdownBeep(frequency, duration = 0.2) {
        // 播放单个倒计时音效：单音（固定音量，不上升下降）
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const masterGain = audioContext.createGain();
            masterGain.connect(audioContext.destination);
            masterGain.gain.value = 0.7;

            const oscillator = audioContext.createOscillator();
            const beepGain = audioContext.createGain();
            
            oscillator.connect(beepGain);
            beepGain.connect(masterGain);
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
            
            // 固定音量，不上升下降
            beepGain.gain.setValueAtTime(0.7, audioContext.currentTime);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + duration);
        } catch (e) {
            console.warn('生成倒计时音效失败:', e);
        }
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
            // 保存当前透明度设置
            const oldAlpha = this.ctx.globalAlpha;
            // 设置透明度（0.6表示60%不透明度，40%透明）
            this.ctx.globalAlpha = 0.6;
            // 以元素中心为基准绘制图片，应用缩放
            this.ctx.drawImage(img, x - scaledWidth / 2, y - scaledHeight / 2, scaledWidth, scaledHeight);
            // 恢复透明度设置
            this.ctx.globalAlpha = oldAlpha;
        } else {
            // 备用：如果图片未加载，使用简单的圆形绘制
            const scale = element.scale || 0.05;
            const size = 30 * scale;
            // 保存当前透明度设置
            const oldAlpha = this.ctx.globalAlpha;
            // 设置透明度
            this.ctx.globalAlpha = 0.6;
            this.ctx.fillStyle = '#90EE90';
                this.ctx.beginPath();
            this.ctx.arc(x, y, size, 0, Math.PI * 2);
                this.ctx.fill();
            // 恢复透明度设置
            this.ctx.globalAlpha = oldAlpha;
        }
    }

    drawTightrope() {
        this.ctx.strokeStyle = '#8B4513';
        this.ctx.lineWidth = this.tightrope.thickness;
        this.ctx.beginPath(); this.ctx.moveTo(this.tightrope.x, 0); this.ctx.lineTo(this.tightrope.x, this.height); this.ctx.stroke();
    }

    // 炸弹Q键救援阶段的UI：Q提示与时间条
    drawBombRescueOverlay() {
        if (!this.bombRescue.active) return;
        const progress = Math.max(0, Math.min(1, 1 - this.bombRescue.timer / this.bombRescue.duration));
        const centerX = this.width / 2;
        const centerY = this.height / 2 - 80;

        this.ctx.save();
        // 半透明遮罩
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        this.ctx.fillRect(0, 0, this.width, this.height);

        // 圆形按键外圈（时间条，单色）
        const outerRadius = 90;
        const innerRadius = 60;
        // 背景圆圈
        this.ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        this.ctx.lineWidth = 10;
        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, outerRadius, 0, Math.PI * 2);
        this.ctx.stroke();
        // 剩余时间圆弧（从顶部顺时针减少）
        const startAngle = -Math.PI / 2;
        const endAngle = startAngle + Math.PI * 2 * progress;
        this.ctx.strokeStyle = '#FFFFFF';
        this.ctx.lineWidth = 10;
        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, outerRadius, startAngle, endAngle);
        this.ctx.stroke();

        // 圆形Q按键
        this.ctx.fillStyle = 'rgba(30,30,30,0.9)';
        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, innerRadius, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.strokeStyle = '#FFFFFF';
        this.ctx.lineWidth = 4;
        this.ctx.stroke();

        // 显示随机救援按键字样
        const keyName = this.bombRescue.rescueKey.replace('Key', ''); // 从KeyQ提取Q
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.font = 'bold 64px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(keyName, centerX, centerY + 2);

        // 左右文字：“按”  “绝处逃生”
        this.ctx.font = 'bold 32px Arial';
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.textAlign = 'right';
        this.ctx.fillText('按', centerX - innerRadius - 40, centerY);
        this.ctx.textAlign = 'left';
        this.ctx.fillText('绝处逃生', centerX + innerRadius + 40, centerY);

        // 剩余时间数字显示在下方
        const remainingSeconds = (this.bombRescue.duration - this.bombRescue.timer) / 60;
        this.ctx.textAlign = 'center';
        this.ctx.font = 'bold 26px Arial';
        this.ctx.fillText(remainingSeconds.toFixed(1) + 's', centerX, centerY + outerRadius + 30);

        this.ctx.restore();
    }


    drawDangerLines() {
        // 绘制60度危险边界虚线
        const pivotX = this.balancePivot.x;
        const pivotY = this.balancePivot.y;
        const absSway = Math.abs(this.player.sway);
        
        // 计算危险程度：0（安全）到1（极度危险）
        let dangerLevel = 0;
        if (absSway >= this.dangerThreshold) {
            // 超过60度后，根据角度和剩余时间计算危险程度
            const angleDanger = Math.min((absSway - this.dangerThreshold) / (this.deathThreshold - this.dangerThreshold), 1);
            const timeDanger = this.dangerZoneTimer / this.dangerZoneDuration;
            dangerLevel = Math.max(angleDanger, timeDanger);
        } else if (absSway >= 45) {
            // 45-60度之间，逐渐变红
            dangerLevel = (absSway - 45) / (this.dangerThreshold - 45);
        }
        
        // 根据危险程度设置颜色：白色 -> 黄色 -> 红色 -> 深红色
        let lineColor;
        if (dangerLevel < 0.3) {
            lineColor = '#FFFFFF'; // 白色
        } else if (dangerLevel < 0.6) {
            // 白色到黄色渐变
            const t = (dangerLevel - 0.3) / 0.3;
            lineColor = `rgb(255, ${255 - Math.floor(t * 100)}, 0)`;
        } else if (dangerLevel < 0.9) {
            // 黄色到红色渐变
            const t = (dangerLevel - 0.6) / 0.3;
            lineColor = `rgb(255, ${155 - Math.floor(t * 155)}, 0)`;
        } else {
            // 红色到深红色
            const t = (dangerLevel - 0.9) / 0.1;
            lineColor = `rgb(${255 - Math.floor(t * 100)}, 0, 0)`;
        }
        
        // 虚线样式
        const dashLength = 10;
        const dashGap = 5;
        const lineLength = 400; // 虚线长度
        
        this.ctx.save();
        this.ctx.strokeStyle = lineColor;
        this.ctx.lineWidth = 3;
        this.ctx.setLineDash([dashLength, dashGap]);
        
        // 绘制左侧60度边界线
        this.ctx.save();
        this.ctx.translate(pivotX, pivotY);
        this.ctx.rotate(-60 * Math.PI / 180);
        this.ctx.beginPath();
        this.ctx.moveTo(0, 0);
        this.ctx.lineTo(0, -lineLength);
        this.ctx.stroke();
        this.ctx.restore();
        
        // 绘制右侧60度边界线
        this.ctx.save();
        this.ctx.translate(pivotX, pivotY);
        this.ctx.rotate(60 * Math.PI / 180);
        this.ctx.beginPath();
        this.ctx.moveTo(0, 0);
        this.ctx.lineTo(0, -lineLength);
        this.ctx.stroke();
        this.ctx.restore();
        
        // 如果进入危险区域，绘制警告效果
        if (absSway >= this.dangerThreshold) {
            const remainingTime = (this.dangerZoneDuration - this.dangerZoneTimer) / 60; // 剩余秒数
            const alpha = 0.3 + 0.3 * Math.sin(Date.now() / 100); // 闪烁效果
            
            // 绘制半透明警告区域
            this.ctx.fillStyle = `rgba(255, 0, 0, ${alpha})`;
            this.ctx.globalAlpha = alpha;
            this.ctx.beginPath();
            this.ctx.moveTo(pivotX, pivotY);
            this.ctx.lineTo(
                pivotX + Math.sin(-60 * Math.PI / 180) * lineLength,
                pivotY - Math.cos(-60 * Math.PI / 180) * lineLength
            );
            this.ctx.lineTo(
                pivotX + Math.sin(60 * Math.PI / 180) * lineLength,
                pivotY - Math.cos(60 * Math.PI / 180) * lineLength
            );
            this.ctx.closePath();
            this.ctx.fill();
            
            // 显示剩余时间（如果剩余时间少于2秒）
            if (remainingTime < 2) {
                this.ctx.globalAlpha = 1;
                this.ctx.fillStyle = '#FF0000';
                this.ctx.font = 'bold 48px Arial';
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText(
                    remainingTime.toFixed(1) + 's',
                    pivotX,
                    pivotY - 100
                );
            }
        }
        
        this.ctx.restore();
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

        // 3) 绝处逢生后的金色半透明保护罩动画（以旋转点为圆心，固定半径400像素的上半圆）
        if (this.bombRescueShield.active) {
            const radius = 400;
            // 以旋转点（balancePivot）为圆心
            const centerX = this.balancePivot.x;
            const centerY = this.balancePivot.y;

            // 根据时间做轻微的呼吸闪烁
            const t = this.bombRescueShield.timer / this.bombRescueShield.duration;
            const alpha = 0.45 * (1 - t);

            this.ctx.save();
            this.ctx.fillStyle = `rgba(255, 215, 0, ${alpha * 0.6})`;
            this.ctx.strokeStyle = `rgba(255, 230, 150, ${alpha})`;
            this.ctx.lineWidth = 3;
            this.ctx.shadowColor = `rgba(255, 215, 0, ${alpha})`;
            this.ctx.shadowBlur = 25;
            this.ctx.beginPath();
            // 以旋转点为圆心，只绘制上半圆护罩
            this.ctx.arc(centerX, centerY, radius, Math.PI, 2 * Math.PI, false);
            this.ctx.lineTo(centerX, centerY);
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.stroke();
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



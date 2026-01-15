// === 전역 변수 및 설정 ===
const DB_FILE = 'db.json';
let config = { owner: '', repo: '', token: '' };
let appData = {
    categories: [{id: 1, name: "일상", children: []}], 
    posts: [] 
};
let editor;
let currentPostId = null;

// === 1. GitHub API 통신 로직 ===

// 한글 깨짐 방지 (UTF-8)
const toBase64 = str => btoa(unescape(encodeURIComponent(str)));
const fromBase64 = str => decodeURIComponent(escape(window.atob(str)));

async function githubAPI(method, path, body = null, sha = null) {
    if (!config.token) return null;
    
    const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}`;
    const headers = {
        'Authorization': `token ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
    };

    const options = { method, headers };
    if (body) {
        options.body = JSON.stringify({
            message: `Update ${path} via Web`,
            content: toBase64(JSON.stringify(body, null, 2)),
            sha: sha
        });
    }

    const res = await fetch(url, options);
    if (!res.ok && res.status !== 404) throw new Error(res.statusText);
    return res.json();
}

async function loadFromGitHub() {
    showLoader(true);
    try {
        const savedConfig = localStorage.getItem('gitConfig');
        if (savedConfig) config = JSON.parse(savedConfig);

        if (!config.token) {
            alert('GitHub 연동 설정이 필요합니다.');
            openConfig();
            showLoader(false);
            return;
        }

        const res = await githubAPI('GET', DB_FILE);
        if (res && res.content) {
            appData = JSON.parse(fromBase64(res.content));
            appData.sha = res.sha;
        } else {
            console.log('DB 파일이 없어 새로 생성할 준비를 합니다.');
        }
        
        initUI();
    } catch (e) {
        alert('데이터 불러오기 실패: ' + e.message);
        openConfig();
    } finally {
        showLoader(false);
    }
}

async function saveToGitHub() {
    showLoader(true);
    try {
        let currentSha = appData.sha;
        try {
            const res = await githubAPI('GET', DB_FILE);
            if(res && res.sha) currentSha = res.sha;
        } catch(e) {}

        const payload = { categories: appData.categories, posts: appData.posts };
        const res = await githubAPI('PUT', DB_FILE, payload, currentSha);
        
        appData.sha = res.content.sha;
        alert('GitHub에 안전하게 저장되었습니다!');
    } catch (e) {
        alert('저장 실패: ' + e.message);
    } finally {
        showLoader(false);
    }
}

// === 2. UI 및 로직 ===

function initUI() {
    renderCategories();
    renderPostList();
    updateCatSelect();
}

// 에디터 초기화
window.onload = function() {
    // Toast UI Editor 로드
    editor = new toastui.Editor({
        el: document.querySelector('#editor'),
        height: '500px',
        initialEditType: 'wysiwyg',
        previewStyle: 'vertical',
        language: 'ko-KR'
    });
    
    // 데이터 로드 시작
    loadFromGitHub();
};

// 카테고리 렌더링
function renderCategories() {
    const root = document.getElementById('category-root');
    const select = document.getElementById('parent-cat-select');
    
    root.innerHTML = `<div class="cat-item"><div class="cat-head" onclick="filterPosts(null)">📂 전체 보기</div></div>`;
    select.innerHTML = '<option value="">최상위 폴더</option>';

    appData.categories.forEach((cat, idx) => {
        let html = `
        <div class="cat-item">
            <div class="cat-head" onclick="filterPosts(${cat.id})">
                <span>${cat.name}</span>
            </div>`;
        
        if(cat.children && cat.children.length > 0) {
            html += `<div class="sub-cat-list">`;
            cat.children.forEach((sub, subIdx) => {
                html += `
                <div class="sub-cat">
                    <span onclick="filterPosts(${sub.id})">- ${sub.name}</span>
                    <div>
                        <i class="fas fa-chevron-up" style="cursor:pointer; font-size:0.7rem;" onclick="reorderCat(${idx}, ${subIdx}, -1)"></i>
                        <i class="fas fa-chevron-down" style="cursor:pointer; font-size:0.7rem;" onclick="reorderCat(${idx}, ${subIdx}, 1)"></i>
                    </div>
                </div>`;
            });
            html += `</div>`;
        }
        html += `</div>`;
        root.innerHTML += html;

        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.text = cat.name;
        select.appendChild(opt);
    });
}

function addCategory() {
    const name = document.getElementById('new-cat-name').value;
    const pid = document.getElementById('parent-cat-select').value;
    if(!name) return;

    if(pid) {
        const parent = appData.categories.find(c => c.id == pid);
        if(parent) {
            if(!parent.children) parent.children = [];
            parent.children.push({ id: Date.now(), name });
        }
    } else {
        appData.categories.push({ id: Date.now(), name, children: [] });
    }
    document.getElementById('new-cat-name').value = '';
    initUI();
}

function reorderCat(pIdx, cIdx, dir) {
    const siblings = appData.categories[pIdx].children;
    const target = cIdx + dir;
    if(target >= 0 && target < siblings.length) {
        [siblings[cIdx], siblings[target]] = [siblings[target], siblings[cIdx]];
        initUI();
    }
}

// 글쓰기 화면 이동
function goWrite() {
    currentPostId = null;
    document.getElementById('write-title').value = '';
    editor.setHTML('');
    updateCatSelect();
    showPage('page-write');
}

// 글 저장
function savePost() {
    const title = document.getElementById('write-title').value;
    const content = editor.getHTML();
    const catId = document.getElementById('write-cat-select').value;

    if(!title || !catId) return alert('제목과 카테고리를 입력해주세요.');

    const post = {
        id: currentPostId || Date.now(),
        title, content, categoryId: catId,
        date: new Date().toLocaleString()
    };

    if(currentPostId) {
        const idx = appData.posts.findIndex(p => p.id === currentPostId);
        appData.posts[idx] = post;
    } else {
        appData.posts.unshift(post);
    }

    saveToGitHub().then(() => {
        goHome();
    });
}

// 글 목록 보기
function filterPosts(catId) {
    renderPostList(catId);
    showPage('page-list');
}

function renderPostList(catId = null) {
    const container = document.getElementById('post-list-container');
    container.innerHTML = '';
    
    let list = appData.posts;
    if(catId) {
        list = list.filter(p => p.categoryId == catId);
        document.getElementById('list-title').innerText = "카테고리 글 목록";
    } else {
        document.getElementById('list-title').innerText = "전체 글 목록";
    }

    if(list.length === 0) container.innerHTML = '<p style="color:#999; text-align:center; padding:20px;">글이 없습니다.</p>';

    list.forEach(post => {
        const div = document.createElement('div');
        div.className = 'post-item';
        div.innerHTML = `<div class="post-title">${post.title}</div><div class="post-date">${post.date}</div>`;
        div.onclick = () => readPost(post.id);
        container.appendChild(div);
    });
}

// 글 읽기
function readPost(id) {
    const post = appData.posts.find(p => p.id === id);
    currentPostId = id;
    document.getElementById('read-title').innerText = post.title;
    document.getElementById('read-date').innerText = post.date;
    document.getElementById('read-content').innerHTML = post.content;
    showPage('page-read');
}

function editPost() {
    const post = appData.posts.find(p => p.id === currentPostId);
    document.getElementById('write-title').value = post.title;
    updateCatSelect();
    document.getElementById('write-cat-select').value = post.categoryId;
    editor.setHTML(post.content);
    showPage('page-write');
}

function deletePost() {
    if(!confirm('삭제하시겠습니까? (GitHub에도 반영됩니다)')) return;
    appData.posts = appData.posts.filter(p => p.id !== currentPostId);
    saveToGitHub().then(() => goHome());
}

// 유틸리티 함수들
function updateCatSelect() {
    const sel = document.getElementById('write-cat-select');
    sel.innerHTML = '<option value="">카테고리 선택</option>';
    appData.categories.forEach(c => {
        if(c.children) {
            c.children.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.id;
                opt.text = `${c.name} > ${s.name}`;
                sel.appendChild(opt);
            });
        }
    });
}

function showPage(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    
    // 뒤로가기 버튼 처리
    const backBtn = document.getElementById('back-btn');
    if (id === 'page-list') {
        backBtn.style.display = 'none';
    } else {
        backBtn.style.display = 'block';
        backBtn.onclick = goHome;
    }
}

function goHome() {
    renderPostList();
    showPage('page-list');
}

function showLoader(flag) {
    document.getElementById('loader').style.display = flag ? 'flex' : 'none';
}

function syncData() {
    saveToGitHub();
}

// 설정 관련
function openConfig() { document.getElementById('config-modal').style.display = 'flex'; }
function closeConfig() { document.getElementById('config-modal').style.display = 'none'; }
function saveConfig() {
    config.owner = document.getElementById('cfg-owner').value;
    config.repo = document.getElementById('cfg-repo').value;
    config.token = document.getElementById('cfg-token').value;
    localStorage.setItem('gitConfig', JSON.stringify(config));
    closeConfig();
    loadFromGitHub();
}
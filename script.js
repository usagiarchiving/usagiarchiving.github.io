// === 전역 변수 ===
const DB_FILE = 'db.json';
let config = { owner: '', repo: '', token: '' };
let appData = {
    categories: [{id: 1, name: "일상", children: []}], 
    posts: [] 
};
let editor;
let currentPostId = null;

// 한글 처리용 Base64
const toBase64 = str => btoa(unescape(encodeURIComponent(str)));
const fromBase64 = str => decodeURIComponent(escape(window.atob(str)));

// === 1. GitHub API (오류 수정됨) ===
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
            message: `Web Update: ${path}`,
            content: toBase64(JSON.stringify(body, null, 2)),
            sha: sha // sha가 있으면 업데이트, 없으면 생성
        });
    }

    const res = await fetch(url, options);

    // [중요] 404 처리를 더 명확하게 함
    if (!res.ok) {
        // GET 요청인데 404면 -> 파일이 없는 것이므로 null 리턴 (에러 아님)
        if (method === 'GET' && res.status === 404) {
            return { content: null }; 
        }
        
        // PUT 요청인데 404면 -> 레포지토리 주소가 틀린 것임 (치명적 에러)
        const errInfo = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(`GitHub Error (${res.status}): ${errInfo.message}`);
    }

    return res.json();
}

async function loadFromGitHub() {
    showLoader(true);
    try {
        const savedConfig = localStorage.getItem('gitConfig');
        if (savedConfig) config = JSON.parse(savedConfig);

        if (!config.token || !config.repo) {
            alert('설정 메뉴에서 GitHub 연동 정보를 입력해주세요.');
            openConfig();
            return;
        }

        const res = await githubAPI('GET', DB_FILE);
        
        // 파일이 존재하면 로드
        if (res && res.content) {
            appData = JSON.parse(fromBase64(res.content));
            appData.sha = res.sha; // 나중에 업데이트할 때 쓸 파일 지문
        } else {
            console.log("새 데이터베이스를 시작합니다.");
        }
        
        initUI();
    } catch (e) {
        alert('불러오기 실패: ' + e.message + '\n\n*설정의 Repo 이름이 정확한지 확인하세요.');
        openConfig();
    } finally {
        showLoader(false);
    }
}

async function saveToGitHub() {
    if(!config.token) {
        alert("GitHub 설정이 되어있지 않습니다.");
        openConfig();
        return;
    }

    showLoader(true);
    try {
        // 1. 최신 SHA 가져오기 (충돌 방지)
        let currentSha = appData.sha;
        try {
            const check = await githubAPI('GET', DB_FILE);
            if(check && check.sha) currentSha = check.sha;
        } catch(e) { /* 파일 없으면 무시 */ }

        // 2. 저장 시도
        const payload = { categories: appData.categories, posts: appData.posts };
        const res = await githubAPI('PUT', DB_FILE, payload, currentSha);

        // [중요] 여기서 res.content가 확실히 있는지 체크
        if (res && res.content && res.content.sha) {
            appData.sha = res.content.sha;
            alert('✅ GitHub에 안전하게 저장되었습니다!');
        } else {
            throw new Error("저장은 된 것 같으나 응답 형식이 이상합니다.");
        }

    } catch (e) {
        alert(`❌ 저장 실패: ${e.message}\n\n*Repo 이름이 틀렸거나, 토큰 권한이 없을 수 있습니다.`);
    } finally {
        showLoader(false);
    }
}

// === 2. 카테고리 로직 (추가/삭제 수정됨) ===
function initUI() {
    renderCategories();
    renderPostList();
    updateCatSelect();
}

// 카테고리 렌더링
function renderCategories() {
    const root = document.getElementById('category-root');
    const select = document.getElementById('parent-cat-select');
    
    root.innerHTML = `<div class="cat-item" onclick="filterPosts(null)"><div class="cat-row"><span class="cat-name">📂 전체 보기</span></div></div>`;
    select.innerHTML = '<option value="">상위 폴더 선택</option>';

    appData.categories.forEach((cat, idx) => {
        // 대분류
        let html = `
        <div class="cat-item">
            <div class="cat-row">
                <span class="cat-name" onclick="filterPosts(${cat.id})">${cat.name}</span>
                <div class="cat-actions">
                    <i class="fas fa-trash-alt icon-btn icon-del" onclick="deleteCategory(${cat.id}, true)"></i>
                </div>
            </div>`;
        
        // 소분류
        if(cat.children && cat.children.length > 0) {
            html += `<div class="sub-cat-list">`;
            cat.children.forEach((sub, subIdx) => {
                html += `
                <div class="sub-cat-row">
                    <span style="flex-grow:1" onclick="filterPosts(${sub.id})">- ${sub.name}</span>
                    <div class="cat-actions">
                        <i class="fas fa-chevron-up icon-btn" onclick="reorderCat(${idx}, ${subIdx}, -1)"></i>
                        <i class="fas fa-chevron-down icon-btn" onclick="reorderCat(${idx}, ${subIdx}, 1)"></i>
                        <i class="fas fa-times icon-btn icon-del" onclick="deleteCategory(${sub.id}, false)"></i>
                    </div>
                </div>`;
            });
            html += `</div>`;
        }
        html += `</div>`;
        root.innerHTML += html;

        // 셀렉트 박스 채우기
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.text = cat.name;
        select.appendChild(opt);
    });
}

// 대분류 추가
function addRootCategory() {
    const name = document.getElementById('new-cat-name').value;
    if(!name) return alert("이름을 입력하세요");
    appData.categories.push({ id: Date.now(), name, children: [] });
    document.getElementById('new-cat-name').value = '';
    initUI();
}

// 소분류 추가
function addSubCategory() {
    const name = document.getElementById('new-cat-name').value;
    const pid = document.getElementById('parent-cat-select').value;
    
    if(!name) return alert("이름을 입력하세요");
    if(!pid) return alert("상위 폴더를 선택하세요 (없으면 대분류 추가 버튼 사용)");

    const parent = appData.categories.find(c => c.id == pid);
    if(parent) {
        if(!parent.children) parent.children = [];
        parent.children.push({ id: Date.now(), name });
        document.getElementById('new-cat-name').value = '';
        initUI();
    }
}

// 카테고리 삭제 (NEW)
function deleteCategory(id, isParent) {
    if(!confirm("정말 삭제하시겠습니까? (속해있는 글은 삭제되지 않지만 카테고리 정보가 사라집니다)")) return;

    if (isParent) {
        // 대분류 삭제
        appData.categories = appData.categories.filter(c => c.id !== id);
    } else {
        // 소분류 삭제
        appData.categories.forEach(p => {
            if(p.children) {
                p.children = p.children.filter(c => c.id !== id);
            }
        });
    }
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

// === 3. 글쓰기 로직 ===
window.onload = function() {
    editor = new toastui.Editor({
        el: document.querySelector('#editor'),
        height: '500px',
        initialEditType: 'wysiwyg',
        previewStyle: 'vertical',
        language: 'ko-KR'
    });
    loadFromGitHub();
};

function goWrite() {
    currentPostId = null;
    document.getElementById('write-title').value = '';
    editor.setHTML('');
    updateCatSelect();
    showPage('page-write');
}

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

    saveToGitHub().then(() => goHome());
}

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
    if(!confirm('글을 삭제하시겠습니까? (GitHub 저장 필요)')) return;
    appData.posts = appData.posts.filter(p => p.id !== currentPostId);
    saveToGitHub().then(() => goHome());
}

// === 유틸 ===
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
    
    const backBtn = document.getElementById('back-btn');
    if (id === 'page-list') backBtn.style.display = 'none';
    else {
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

function syncData() { saveToGitHub(); }

// 설정
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

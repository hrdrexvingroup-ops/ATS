// ========== GROQ API ==========
let GROQ_API_KEY = localStorage.getItem('groq_api_key') || '';

// Fungsi notifikasi
function showNotification(msg, isError = false) {
    const statusDiv = document.getElementById('apiStatus');
    if (statusDiv) {
        statusDiv.innerHTML = isError ? `❌ ${msg}` : `✅ ${msg}`;
        statusDiv.style.color = isError ? '#dc2626' : '#10b981';
        setTimeout(() => {
            if (statusDiv.innerHTML === `✅ ${msg}` || statusDiv.innerHTML === `❌ ${msg}`) 
                statusDiv.innerHTML = '';
        }, 5000);
    } else {
        alert(msg);
    }
}

// Test koneksi API Key
async function testGroqConnection(apiKey) {
    try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',  // model yang lebih stabil
                messages: [{ role: 'user', content: 'OK' }],
                max_tokens: 5
            })
        });
        if (res.ok) {
            showNotification('API Key Groq valid dan terhubung!');
            return true;
        } else {
            const err = await res.json();
            showNotification(`API Key gagal: ${err.error?.message || 'Invalid key'}`, true);
            return false;
        }
    } catch (e) {
        showNotification(`Gagal connect: ${e.message}`, true);
        return false;
    }
}

async function saveApiKey() {
    const key = document.getElementById('apiKey').value.trim();
    if (!key) {
        showNotification('Masukkan API Key', true);
        return;
    }
    showNotification('Menguji koneksi...');
    const isValid = await testGroqConnection(key);
    if (isValid) {
        GROQ_API_KEY = key;
        localStorage.setItem('groq_api_key', key);
    }
}

// ========== BACA CV ==========
async function readCV(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    try {
        if (ext === 'pdf') {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            let fullText = '';
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const content = await page.getTextContent();
                fullText += content.items.map(item => item.str).join(' ') + '\n';
            }
            return fullText;
        } else if (ext === 'docx' || ext === 'doc') {
            const arrayBuffer = await file.arrayBuffer();
            const result = await mammoth.extractRawText({ arrayBuffer });
            return result.value;
        }
        return '';
    } catch(e) {
        console.error(e);
        return '';
    }
}

// ========== EKSTRAKSI DATA CV ==========
function parseCV(text) {
    if (!text) return { name: '-', age: '-', education: '-', major: '-', address: '-', experience: '-' };
    const clean = text.replace(/\s+/g, ' ').trim();
    const lower = clean.toLowerCase();
    
    let name = 'Tidak terdeteksi';
    const nameMatch = clean.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/);
    if (nameMatch) name = nameMatch[1];
    
    let age = '-';
    const ageMatch = clean.match(/\b(\d{1,2})\s*(tahun|thn|t)\b/i);
    if (ageMatch) age = ageMatch[1];
    
    let edu = '-';
    if (lower.includes('s2') || lower.includes('magister')) edu = 'S2';
    else if (lower.includes('s1') || lower.includes('sarjana')) edu = 'S1';
    else if (lower.includes('d3')) edu = 'D3';
    else if (lower.includes('sma')) edu = 'SMA';
    
    let major = '-';
    const jurusan = ['teknik sipil', 'akuntansi', 'manajemen', 'informatika', 'hukum'];
    for (let j of jurusan) if (lower.includes(j)) { major = j.toUpperCase(); break; }
    
    let address = '-';
    const addrMatch = clean.match(/alamat\s*:?\s*([^,\n]+)/i);
    if (addrMatch) address = addrMatch[1].trim().substring(0, 50);
    
    let expSummary = '-';
    const expRegex = /([A-Z][a-z\s&]+(?:PT\.?|CV\.?)?)\s*(\d{4})\s*[-–]\s*(\d{4}|sekarang)/gi;
    let matches = [...clean.matchAll(expRegex)];
    if (matches.length) {
        expSummary = matches.slice(0,2).map(m => `${m[1].trim()} (${m[2]}–${m[3]})`).join('; ');
    } else {
        const idx = lower.indexOf('pengalaman');
        if (idx !== -1) expSummary = clean.substring(idx, idx+120).replace(/\n/g,' ');
    }
    return { name, age, education: edu, major, address, experience: expSummary };
}

// ========== ANALISIS KECOCOKAN PAKAI GROQ ==========
async function getMatchScore(cvText, jobTitle, qualification, jobdesc) {
    if (!GROQ_API_KEY) {
        showNotification('⚠️ API Key belum disimpan. Skor perkiraan saja.', true);
        // fallback keyword
        const requirement = (qualification + ' ' + jobdesc).toLowerCase();
        const cv = cvText.toLowerCase();
        const keywords = requirement.split(/\s+/).filter(w => w.length > 4);
        let match = 0;
        keywords.forEach(k => { if(cv.includes(k)) match++; });
        let score = keywords.length ? Math.min(95, Math.max(40, Math.round((match/keywords.length)*100))) : 55;
        return { score, reason: 'Lokal (tanpa API)' };
    }
    
    const prompt = `Bandingkan CV ini dengan requirement:
Job Title: ${jobTitle}
Kualifikasi: ${qualification}
Jobdesc: ${jobdesc}

CV:
${cvText.substring(0, 2500)}

Output HARUS:
Score: (0-100)
Alasan: (singkat)`;
    
    try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.2,
                max_tokens: 150
            })
        });
        if (!res.ok) {
            const err = await res.json();
            showNotification(`Groq error: ${err.error?.message}`, true);
            return { score: 50, reason: 'API error' };
        }
        const data = await res.json();
        const reply = data.choices[0].message.content;
        const scoreMatch = reply.match(/Score:\s*(\d+)/i);
        let score = scoreMatch ? parseInt(scoreMatch[1]) : 50;
        score = Math.min(100, Math.max(0, score));
        const reasonMatch = reply.match(/Alasan:\s*(.*)/is);
        const reason = reasonMatch ? reasonMatch[1].substring(0,100) : '';
        return { score, reason };
    } catch(e) {
        console.error(e);
        showNotification(`Gagal koneksi Groq: ${e.message}`, true);
        return { score: 50, reason: 'Koneksi gagal' };
    }
}

// ========== MAIN ANALISIS ==========
let allResults = [];

async function startAnalysis() {
    const jobTitle = document.getElementById('jobTitle').value.trim();
    const qualification = document.getElementById('qualification').value.trim();
    const jobdesc = document.getElementById('jobdesc').value.trim();
    const files = document.getElementById('cvFiles').files;
    
    if (!jobTitle || !qualification || !jobdesc) return alert('Lengkapi semua data');
    if (!files.length) return alert('Upload CV');
    
    if (!GROQ_API_KEY) showNotification('API Key belum disimpan, skor kurang akurat', true);
    else showNotification('Menggunakan Groq API...');
    
    document.getElementById('loading').style.display = 'block';
    document.getElementById('resultCard').style.display = 'none';
    allResults = [];
    
    for (let i = 0; i < files.length; i++) {
        const text = await readCV(files[i]);
        if (!text) continue;
        const parsed = parseCV(text);
        const { score } = await getMatchScore(text, jobTitle, qualification, jobdesc);
        let rec = score >= 85 ? 'High Priority' : (score >= 70 ? 'Layak Interview' : 'Cadangan');
        let badge = score >= 85 ? 'badge-high' : (score >= 70 ? 'badge-mid' : 'badge-low');
        allResults.push({ ...parsed, score, recommendation: rec, badgeClass: badge });
    }
    
    allResults.sort((a,b) => b.score - a.score);
    renderTable();
    document.getElementById('loading').style.display = 'none';
    document.getElementById('resultCard').style.display = 'block';
    showNotification(`Selesai! ${allResults.length} kandidat dianalisis.`);
}

function renderTable() {
    const tbody = document.getElementById('resultBody');
    tbody.innerHTML = '';
    allResults.forEach((r, i) => {
        tbody.innerHTML += `<tr>
            <td>${i+1}</td>
            <td>${escapeHtml(r.name)}</td>
            <td>${escapeHtml(r.age)}</td>
            <td>${escapeHtml(r.education)}</td>
            <td>${escapeHtml(r.major)}</td>
            <td>${escapeHtml(r.address)}</td>
            <td>${escapeHtml(r.experience.substring(0,100))}</td>
            <td><strong>${r.score}%</strong></td>
            <td><span class="badge ${r.badgeClass}">${r.recommendation}</span></td>
        </tr>`;
    });
}

function escapeHtml(str) { return (str || '-').replace(/[&<>]/g, function(m){return m==='&'?'&amp;':m==='<'?'&lt;':'&gt;';}); }
function resetForm() { location.reload(); }
function exportToExcel() {
    if (!allResults.length) return alert('Tidak ada data');
    const data = allResults.map((r,i)=>({No:i+1, Nama:r.name, Usia:r.age, Pendidikan:r.education, Jurusan:r.major, Alamat:r.address, Pengalaman:r.experience, Skor:`${r.score}%`, Rekomendasi:r.recommendation}));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ranking');
    XLSX.writeFile(wb, `Rexvin_${Date.now()}.xlsx`);
    showNotification('Export Excel berhasil');
}

window.onload = () => {
    if (localStorage.getItem('groq_api_key')) {
        GROQ_API_KEY = localStorage.getItem('groq_api_key');
        document.getElementById('apiKey').value = GROQ_API_KEY;
        showNotification('API Key tersedia. Klik "Simpan Key" untuk verifikasi ulang.');
    } else {
        showNotification('Masukkan Groq API Key untuk analisis akurat.');
    }
};

// ========== GROQ API ==========
let GROQ_API_KEY = localStorage.getItem('groq_api_key') || '';

// Notifikasi
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
                model: 'llama-3.3-70b-versatile',
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

// ========== PARSE CV (PINTAR) ==========
function parseCV(text) {
    if (!text) return { name: '-', age: '-', education: '-', major: '-', address: '-', experience: '-' };
    
    let clean = text.replace(/[^\w\s\.,\-@\(\)]/g, ' ').replace(/\s+/g, ' ').trim();
    let lower = clean.toLowerCase();
    
    // NAMA
    let name = 'Tidak terdeteksi';
    let namaMatch = clean.match(/Nama\s*:?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4})/i);
    if (namaMatch) name = namaMatch[1];
    else {
        let lines = clean.split(/[\.\n]/);
        for (let line of lines) {
            line = line.trim();
            if (line.length > 5 && line.length < 50 && /^[A-Z][a-z]/.test(line) && !line.includes('CV') && !line.includes('CURRICULUM')) {
                name = line;
                break;
            }
        }
    }
    
    // USIA
    let age = '-';
    let ageMatch = clean.match(/(?:umur|usia)\s*:?\s*(\d{1,2})/i);
    if (ageMatch) age = ageMatch[1];
    else {
        let birthYear = clean.match(/\b(19[7-9][0-9]|20[0-2][0-9])\b/);
        if (birthYear) {
            let tahunLahir = parseInt(birthYear[0]);
            let now = new Date().getFullYear();
            let hitung = now - tahunLahir;
            if (hitung > 15 && hitung < 70) age = hitung.toString();
        }
    }
    
    // PENDIDIKAN
    let edu = '-';
    if (lower.includes('s2') || lower.includes('magister')) edu = 'S2';
    else if (lower.includes('s1') || lower.includes('sarjana')) edu = 'S1';
    else if (lower.includes('d4')) edu = 'D4';
    else if (lower.includes('d3')) edu = 'D3';
    else if (lower.includes('sma')) edu = 'SMA';
    else if (lower.includes('smk')) edu = 'SMK';
    
    // JURUSAN
    let major = '-';
    let jurusanList = ['teknik sipil', 'akuntansi', 'manajemen', 'informatika', 'sistem informasi', 'hukum', 'psikologi', 'arsitektur', 'ekonomi', 'komunikasi'];
    for (let j of jurusanList) {
        if (lower.includes(j)) {
            major = j.toUpperCase();
            break;
        }
    }
    let jurMatch = clean.match(/jurusan\s*:?\s*([A-Za-z\s]{3,40})/i);
    if (jurMatch && jurMatch[1].trim().length < 50) major = jurMatch[1].trim();
    
    // ALAMAT
    let address = '-';
    let addrMatch = clean.match(/alamat\s*:?\s*([^,.\n]{10,80})/i);
    if (addrMatch) address = addrMatch[1].trim();
    else {
        let kota = ['jakarta', 'bandung', 'surabaya', 'medan', 'batam', 'padang', 'palembang', 'makassar', 'semarang'];
        for (let k of kota) {
            if (lower.includes(k)) {
                address = k.charAt(0).toUpperCase() + k.slice(1);
                break;
            }
        }
    }
    
    // PENGALAMAN
    let expSummary = '-';
    let expRegex = /([A-Z][a-z\s&]+(?:PT\.?|CV\.?|Perusahaan)?)\s*(\d{4})\s*[-–]\s*(\d{4}|sekarang)/gi;
    let matches = [...clean.matchAll(expRegex)];
    if (matches.length) {
        expSummary = matches.slice(0, 2).map(m => `${m[1].trim()} (${m[2]}–${m[3]})`).join('; ');
    } else {
        let idx = lower.indexOf('pengalaman');
        if (idx !== -1) expSummary = clean.substring(idx, idx+150).replace(/\n/g,' ');
        else if (lower.includes('bekerja')) {
            let idx2 = lower.indexOf('bekerja');
            expSummary = clean.substring(idx2, idx2+120);
        }
    }
    
    return { name, age, education: edu, major, address, experience: expSummary };
}

// ========== ANALISIS KECOCOKAN DENGAN GROQ ==========
async function getMatchScore(cvText, jobTitle, qualification, jobdesc) {
    if (!GROQ_API_KEY) {
        showNotification('⚠️ API Key belum disimpan. Skor perkiraan.', true);
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
${cvText.substring(0, 3000)}

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

// ========== VARIABEL GLOBAL ==========
let allResults = [];

// ========== ANALISIS UTAMA ==========
async function startAnalysis() {
    const jobTitle = document.getElementById('jobTitle').value.trim();
    const qualification = document.getElementById('qualification').value.trim();
    const jobdesc = document.getElementById('jobdesc').value.trim();
    const files = document.getElementById('cvFiles').files;
    
    if (!jobTitle || !qualification || !jobdesc) {
        alert('Lengkapi Nama Posisi, Kualifikasi, dan Job Description');
        return;
    }
    if (!files.length) {
        alert('Upload minimal 1 CV');
        return;
    }
    
    if (!GROQ_API_KEY) {
        showNotification('API Key belum disimpan, skor kurang akurat', true);
    } else {
        showNotification('Menggunakan Groq API untuk analisis...');
    }
    
    document.getElementById('loading').style.display = 'block';
    document.getElementById('resultCard').style.display = 'none';
    allResults = [];
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        showNotification(`Membaca ${file.name}...`);
        const text = await readCV(file);
        if (!text || text.length < 30) {
            console.warn(`Gagal baca ${file.name}`);
            continue;
        }
        const parsed = parseCV(text);
        const { score } = await getMatchScore(text, jobTitle, qualification, jobdesc);
        let rec = score >= 85 ? 'High Priority' : (score >= 70 ? 'Layak Interview' : 'Cadangan');
        let badge = score >= 85 ? 'badge-high' : (score >= 70 ? 'badge-mid' : 'badge-low');
        allResults.push({ ...parsed, score, recommendation: rec, badgeClass: badge });
    }
    
    if (allResults.length === 0) {
        showNotification('Tidak ada CV yang berhasil dibaca', true);
        document.getElementById('loading').style.display = 'none';
        return;
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

function escapeHtml(str) {
    if (!str) return '-';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

function resetForm() {
    document.getElementById('jobTitle').value = '';
    document.getElementById('department').value = '';
    document.getElementById('qualification').value = '';
    document.getElementById('jobdesc').value = '';
    document.getElementById('cvFiles').value = '';
    document.getElementById('resultCard').style.display = 'none';
    allResults = [];
    showNotification('Form direset');
}

function exportToExcel() {
    if (!allResults.length) {
        alert('Tidak ada data');
        return;
    }
    const data = allResults.map((r,i) => ({
        No: i+1,
        Nama: r.name,
        Usia: r.age,
        Pendidikan: r.education,
        Jurusan: r.major,
        Alamat: r.address,
        Pengalaman: r.experience,
        Skor: `${r.score}%`,
        Rekomendasi: r.recommendation
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ranking');
    XLSX.writeFile(wb, `Rexvin_ATS_${Date.now()}.xlsx`);
    showNotification('Export Excel berhasil');
}

// Inisialisasi saat halaman dimuat
window.onload = () => {
    if (localStorage.getItem('groq_api_key')) {
        GROQ_API_KEY = localStorage.getItem('groq_api_key');
        const inputKey = document.getElementById('apiKey');
        if (inputKey) inputKey.value = GROQ_API_KEY;
        showNotification('API Key tersedia. Klik "Simpan Key" untuk verifikasi ulang.');
    } else {
        showNotification('Masukkan Groq API Key untuk analisis akurat.');
    }
};

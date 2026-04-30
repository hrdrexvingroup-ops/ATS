// ========== GROQ API ==========
let GROQ_API_KEY = localStorage.getItem('groq_api_key') || '';

function saveApiKey() {
    const key = document.getElementById('apiKey').value.trim();
    if (!key) return alert('Masukkan API Key');
    GROQ_API_KEY = key;
    localStorage.setItem('groq_api_key', key);
    document.getElementById('apiStatus').innerHTML = '✓ API Key tersimpan';
    setTimeout(() => document.getElementById('apiStatus').innerHTML = '', 2000);
}

// ========== BACA CV ==========
async function readCV(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'pdf') {
        return await readPDF(file);
    } else if (ext === 'docx' || ext === 'doc') {
        return await readDOCX(file);
    } else {
        return '';
    }
}

async function readPDF(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const strings = content.items.map(item => item.str);
        fullText += strings.join(' ') + '\n';
    }
    return fullText;
}

async function readDOCX(file) {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
}

// ========== EKSTRAKSI DATA DARI TEXT CV ==========
function parseCV(text) {
    const lower = text.toLowerCase();
    // Nama (cari di awal atau pola)
    let name = 'Tidak terdeteksi';
    const nameMatch = text.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/m);
    if (nameMatch) name = nameMatch[1];
    // Usia
    let age = '-';
    const ageMatch = text.match(/\b(\d{1,2})\s*(tahun|thn|t)\b/i);
    if (ageMatch) age = ageMatch[1];
    // Pendidikan
    let edu = '-';
    if (lower.includes('s1') || lower.includes('sarjana')) edu = 'S1';
    else if (lower.includes('s2') || lower.includes('magister')) edu = 'S2';
    else if (lower.includes('d3')) edu = 'D3';
    else if (lower.includes('sma')) edu = 'SMA';
    // Jurusan
    let major = '-';
    const jurusan = text.match(/jurusan\s*:?\s*([^\n]+)/i);
    if (jurusan) major = jurusan[1];
    else if (lower.includes('akuntansi')) major = 'Akuntansi';
    else if (lower.includes('manajemen')) major = 'Manajemen';
    else if (lower.includes('informatika')) major = 'Informatika';
    // Alamat
    let address = '-';
    const alamat = text.match(/alamat\s*:?\s*([^\n]+)/i);
    if (alamat) address = alamat[1];
    // Ringkasan pengalaman (ambil 2 baris pertama yang mengandung tahun)
    let expSummary = '-';
    const expRegex = /([A-Z][a-z\s]+)\s*(\d{4})\s*[-–]\s*(\d{4}|sekarang)/gi;
    let matches = [...text.matchAll(expRegex)];
    if (matches.length) {
        expSummary = matches.slice(0,2).map(m => `${m[1]} (${m[2]}–${m[3]})`).join('; ');
    } else {
        // fallback ambil kalimat pertama mengandung "pengalaman"
        const idx = lower.indexOf('pengalaman');
        if (idx !== -1) expSummary = text.substring(idx, idx+150).replace(/\n/g,' ').trim();
    }
    return { name, age, education: edu, major, address, experience: expSummary };
}

// ========== ANALISIS KECOCOKAN VIA GROQ ==========
async function getMatchScore(cvText, jobTitle, qualification, jobdesc) {
    if (!GROQ_API_KEY) {
        // Fallback simpel: hitung persamaan kata kunci
        const requirement = (qualification + ' ' + jobdesc).toLowerCase();
        const cv = cvText.toLowerCase();
        const keywords = requirement.split(/\s+/).filter(w => w.length>4);
        let match = 0;
        keywords.forEach(k => { if(cv.includes(k)) match++; });
        let score = keywords.length ? Math.round((match/keywords.length)*100) : 50;
        return { score, reason: 'Kalkulasi lokal (tanpa API)' };
    }
    
    const prompt = `Anda adalah HRD profesional. Bandingkan CV berikut dengan requirement posisi.
    Job Title: ${jobTitle}
    Kualifikasi: ${qualification}
    Job Description: ${jobdesc}
    
    CV Kandidat:
    ${cvText.substring(0, 2500)}
    
    Berikan output hanya dalam format:
    Score: (0-100)
    Alasan singkat: (maks 100 kata)
    `;
    
    try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: 'llama3-70b-8192',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.2,
                max_tokens: 300
            })
        });
        const data = await res.json();
        const reply = data.choices?.[0]?.message?.content || '';
        const scoreMatch = reply.match(/Score:\s*(\d+)/i);
        const score = scoreMatch ? Math.min(100, parseInt(scoreMatch[1])) : 50;
        const reasonMatch = reply.match(/Alasan:\s*(.*)/is);
        const reason = reasonMatch ? reasonMatch[1].substring(0,150) : '';
        return { score, reason };
    } catch(e) {
        console.error(e);
        return { score: 50, reason: 'Gagal koneksi API' };
    }
}

// ========== VARIABEL GLOBAL ==========
let allResults = [];

// ========== ANALISIS UTAMA ==========
async function startAnalysis() {
    const jobTitle = document.getElementById('jobTitle').value.trim();
    const department = document.getElementById('department').value.trim();
    const qualification = document.getElementById('qualification').value.trim();
    const jobdesc = document.getElementById('jobdesc').value.trim();
    const files = document.getElementById('cvFiles').files;
    
    if (!jobTitle || !qualification || !jobdesc) {
        alert('Lengkapi Nama Posisi, Kualifikasi, dan Job Description');
        return;
    }
    if (files.length === 0) {
        alert('Upload minimal 1 CV');
        return;
    }
    if (!GROQ_API_KEY) {
        if(!confirm('Groq API Key belum disimpan. Lanjut dengan analisis sederhana (kurang akurat)?')) return;
    }
    
    document.getElementById('loading').style.display = 'block';
    document.getElementById('resultCard').style.display = 'none';
    allResults = [];
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileText = await readCV(file);
        if (!fileText) {
            alert(`Gagal membaca ${file.name}`);
            continue;
        }
        const parsed = parseCV(fileText);
        const { score, reason } = await getMatchScore(fileText, jobTitle, qualification, jobdesc);
        
        let recommendation = score >= 85 ? 'High Priority' : (score >= 70 ? 'Layak Interview' : 'Cadangan');
        let badgeClass = score >= 85 ? 'badge-high' : (score >= 70 ? 'badge-mid' : 'badge-low');
        
        allResults.push({
            ...parsed,
            score,
            recommendation,
            badgeClass,
            reason
        });
    }
    
    allResults.sort((a,b) => b.score - a.score);
    renderTable();
    document.getElementById('loading').style.display = 'none';
    document.getElementById('resultCard').style.display = 'block';
}

function renderTable() {
    const tbody = document.getElementById('resultBody');
    tbody.innerHTML = '';
    allResults.forEach((r, idx) => {
        const row = `<tr>
            <td>${idx+1}</td>
            <td>${r.name}</td>
            <td>${r.age}</td>
            <td>${r.education}</td>
            <td>${r.major}</td>
            <td>${r.address}</td>
            <td>${r.experience.substring(0,120)}</td>
            <td><strong>${r.score}%</strong></td>
            <td><span class="badge ${r.badgeClass}">${r.recommendation}</span></td>
        </tr>`;
        tbody.innerHTML += row;
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
}

function exportToExcel() {
    if (!allResults.length) return alert('Tidak ada data');
    const exportData = allResults.map((r, i) => ({
        No: i+1,
        Nama: r.name,
        Usia: r.age,
        Pendidikan: r.education,
        Jurusan: r.major,
        Alamat: r.address,
        Pengalaman: r.experience,
        Skor: r.score + '%',
        Rekomendasi: r.recommendation
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ranking');
    XLSX.writeFile(wb, `Rexvin_ATS_${new Date().toISOString().slice(0,16)}.xlsx`);
}

// Inisialisasi tampilkan API key yang tersimpan
window.onload = () => {
    if (localStorage.getItem('groq_api_key')) {
        document.getElementById('apiStatus').innerHTML = '✓ API Key sudah tersimpan';
    }
};

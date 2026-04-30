// ========== GROQ API ==========
let GROQ_API_KEY = localStorage.getItem('groq_api_key') || '';

function saveApiKey() {
    const key = document.getElementById('apiKey').value.trim();
    if (!key) return alert('Masukkan API Key');
    if (!key.startsWith('gsk_')) return alert('API Key Groq biasanya diawali "gsk_". Cek kembali.');
    GROQ_API_KEY = key;
    localStorage.setItem('groq_api_key', key);
    document.getElementById('apiStatus').innerHTML = '✓ API Key tersimpan';
    document.getElementById('apiStatus').style.color = '#10b981';
    setTimeout(() => document.getElementById('apiStatus').innerHTML = '', 3000);
}

// ========== BACA CV ==========
async function readCV(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    try {
        if (ext === 'pdf') {
            return await readPDF(file);
        } else if (ext === 'docx' || ext === 'doc') {
            return await readDOCX(file);
        } else {
            return '';
        }
    } catch(e) {
        console.error(e);
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

// ========== EKSTRAKSI DATA DARI TEXT CV (LEBIH CERDAS) ==========
function parseCV(text) {
    if (!text) return { name: '-', age: '-', education: '-', major: '-', address: '-', experience: '-' };
    
    // Bersihkan teks: hapus karakter aneh, ganti newline dengan spasi
    let clean = text.replace(/[\n\r\t]+/g, ' ').replace(/\s+/g, ' ');
    
    // NAMA: cari pola Nama: atau nama besar di awal, atau setelah "Nama", "Curriculum Vitae", dll
    let name = '-';
    // Cari "Nama : ..." atau "Nama ..."
    let nameMatch = clean.match(/Nama\s*:\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,4})/i);
    if (!nameMatch) nameMatch = clean.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/);
    if (nameMatch) name = nameMatch[1].trim();
    // Jika masih gagal, coba ambil kata setelah "CV" atau "CURRICULUM VITAE"
    if (name === '-') {
        let cvMatch = clean.match(/CURRICULUM VITAE\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/i);
        if (cvMatch) name = cvMatch[1];
    }
    
    // USIA: cari angka diikuti tahun/tahun/thn
    let age = '-';
    let ageMatch = clean.match(/\b(\d{1,2})\s*(tahun|thn|t)\b/i);
    if (ageMatch) age = ageMatch[1];
    // cari juga "Usia : XX"
    let usiaMatch = clean.match(/usia\s*:\s*(\d{1,2})/i);
    if (usiaMatch) age = usiaMatch[1];
    
    // PENDIDIKAN: cari S1, S2, D3, SMA
    let edu = '-';
    if (/\bS2\b|\bMagister\b/i.test(clean)) edu = 'S2';
    else if (/\bS1\b|\bSarjana\b/i.test(clean)) edu = 'S1';
    else if (/\bD4\b/i.test(clean)) edu = 'D4';
    else if (/\bD3\b/i.test(clean)) edu = 'D3';
    else if (/\bSMA\b|\bSekolah Menengah Atas\b/i.test(clean)) edu = 'SMA';
    else if (/\bSMK\b/i.test(clean)) edu = 'SMK';
    
    // JURUSAN: cari "Jurusan", "Teknik", "Manajemen", dll
    let major = '-';
    let jurusanMatch = clean.match(/jurusan\s*:?\s*([A-Za-z\s]+?)(?=\.|\d|$)/i);
    if (jurusanMatch) major = jurusanMatch[1].trim().substring(0, 30);
    else {
        if (clean.includes('Teknik Sipil')) major = 'Teknik Sipil';
        else if (clean.includes('Manajemen')) major = 'Manajemen';
        else if (clean.includes('Akuntansi')) major = 'Akuntansi';
        else if (clean.includes('Informatika')) major = 'Informatika';
    }
    
    // ALAMAT: cari "Alamat : ..." atau pola jalan
    let address = '-';
    let alamatMatch = clean.match(/alamat\s*:?\s*([^,]+(?:jalan|jl\.|perum|kavling)[^,]+)/i);
    if (alamatMatch) address = alamatMatch[1].trim().substring(0, 50);
    // cari juga kota
    let kotaMatch = clean.match(/\b(Batam|Jakarta|Bandung|Surabaya|Medan|Padang|Balikpapan)\b/i);
    if (kotaMatch && address === '-') address = kotaMatch[1];
    
    // RINGKASAN PENGALAMAN: ambil nama perusahaan dan tahun
    let experience = '-';
    // pola: Nama Perusahaan (tahun - tahun) atau tahun - tahun Nama Perusahaan
    let expRegex = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*[\(]?(\d{4})\s*[-–]\s*(\d{4}|sekarang)[\)]?/gi;
    let matches = [...clean.matchAll(expRegex)];
    if (matches.length) {
        experience = matches.slice(0, 2).map(m => `${m[1]} (${m[2]}–${m[3]})`).join('; ');
    } else {
        // fallback: ambil kalimat mengandung "pengalaman" atau "bekerja"
        let expIndex = clean.search(/pengalaman|bekerja|pernah|sebagai/i);
        if (expIndex !== -1 && expIndex < 800) {
            experience = clean.substring(expIndex, expIndex+150).trim();
        }
    }
    
    return { name, age, education: edu, major, address, experience: experience.substring(0, 120) };
}

// ========== ANALISIS KECOCOKAN VIA GROQ (WAJIB API) ==========
async function getMatchScore(cvText, jobTitle, qualification, jobdesc, candidateName) {
    // Jika tidak ada API key, beri pesan error dan return 0
    if (!GROQ_API_KEY) {
        console.warn('GROQ API KEY MISSING');
        return { score: 0, reason: 'API Key belum disimpan' };
    }
    
    // Potong CV terlalu panjang (max 3000 karakter)
    const trimmedCV = cvText.length > 2800 ? cvText.substring(0, 2800) + '...' : cvText;
    
    const prompt = `Anda adalah HRD profesional. Berikan skor kesesuaian (0-100) untuk kandidat berikut.

POSISI: ${jobTitle}
KUALIFIKASI YANG DIBUTUHKAN:
${qualification}

JOB DESCRIPTION:
${jobdesc}

CV KANDIDAT (${candidateName}):
${trimmedCV}

INSTRUKSI KETAT:
1. Berikan output HANYA dalam format JSON di bawah ini, TIDAK ADA TEKS LAIN:
{
  "score": (angka 0-100),
  "reason": "alasan singkat maksimal 50 kata"
}
2. Score harus berdasarkan: pendidikan (20%), pengalaman kerja (30%), skill match (30%), kesesuaian industri (20%).
3. Jika CV tidak terbaca atau kosong, score = 20 dengan reason "CV tidak terbaca".
4. JANGAN tambahkan kata pengantar atau penjelasan di luar JSON.`;

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1,
                max_tokens: 300
            })
        });
        
        const data = await response.json();
        if (!response.ok) {
            console.error('Groq API Error:', data);
            return { score: 0, reason: `API Error: ${data.error?.message || 'Unknown'}` };
        }
        
        const reply = data.choices?.[0]?.message?.content || '';
        console.log('Groq reply:', reply);
        
        // Parse JSON dari reply
        let jsonMatch = reply.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return { score: 0, reason: 'Format API salah' };
        
        const result = JSON.parse(jsonMatch[0]);
        let score = parseInt(result.score) || 0;
        score = Math.min(100, Math.max(0, score));
        return { score, reason: result.reason || '-' };
        
    } catch(e) {
        console.error('Groq exception:', e);
        return { score: 0, reason: 'Gagal koneksi ke Groq' };
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
        alert('⚠️ Groq API Key belum disimpan. Masukkan API Key di bagian atas, lalu klik Simpan Key.\n\nJika tidak punya, daftar gratis di console.groq.com');
        return;
    }
    
    document.getElementById('loading').style.display = 'block';
    document.getElementById('resultCard').style.display = 'none';
    allResults = [];
    
    let successCount = 0;
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        console.log(`Processing ${file.name}...`);
        const fileText = await readCV(file);
        if (!fileText || fileText.length < 50) {
            console.warn(`Gagal baca ${file.name}`);
            allResults.push({
                name: file.name.replace(/\.(pdf|docx?)$/i, ''),
                age: '-', education: '-', major: '-', address: '-', experience: 'Tidak terbaca',
                score: 0, recommendation: 'Error', badgeClass: 'badge-low', reason: 'File tidak bisa dibaca'
            });
            continue;
        }
        
        const parsed = parseCV(fileText);
        console.log(`Parsed ${parsed.name}, calling Groq...`);
        const { score, reason } = await getMatchScore(fileText, jobTitle, qualification, jobdesc, parsed.name);
        
        let recommendation = score >= 85 ? 'High Priority' : (score >= 70 ? 'Layak Interview' : (score >= 50 ? 'Cadangan' : 'Tidak Direkomendasi'));
        let badgeClass = score >= 85 ? 'badge-high' : (score >= 70 ? 'badge-mid' : 'badge-low');
        
        allResults.push({
            ...parsed,
            score: score,
            recommendation: recommendation,
            badgeClass: badgeClass,
            reason: reason
        });
        
        if (score > 0) successCount++;
        await new Promise(r => setTimeout(r, 500)); // delay antar request
    }
    
    allResults.sort((a,b) => b.score - a.score);
    renderTable();
    document.getElementById('loading').style.display = 'none';
    document.getElementById('resultCard').style.display = 'block';
    
    if (successCount === 0) {
        alert('Tidak ada CV yang berhasil diproses. Cek koneksi API atau format file.');
    }
}

function renderTable() {
    const tbody = document.getElementById('resultBody');
    tbody.innerHTML = '';
    allResults.forEach((r, idx) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${idx+1}</td>
            <td>${r.name}</td>
            <td>${r.age}</td>
            <td>${r.education}</td>
            <td>${r.major}</td>
            <td>${r.address}</td>
            <td>${r.experience}</td>
            <td><strong>${r.score}%</strong></td>
            <td><span class="badge ${r.badgeClass}">${r.recommendation}</span></td>
        `;
        tbody.appendChild(row);
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
        Rekomendasi: r.recommendation,
        Alasan: r.reason
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ranking');
    XLSX.writeFile(wb, `Rexvin_ATS_${new Date().toISOString().slice(0,19)}.xlsx`);
}

window.onload = () => {
    if (localStorage.getItem('groq_api_key')) {
        document.getElementById('apiStatus').innerHTML = '✓ API Key sudah tersimpan';
        document.getElementById('apiStatus').style.color = '#10b981';
        GROQ_API_KEY = localStorage.getItem('groq_api_key');
    }
};

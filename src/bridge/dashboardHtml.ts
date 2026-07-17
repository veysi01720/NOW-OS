export const dashboardHtml = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NOW OS - Operasyon Paneli</title>
  <style>
    :root {
      --primary: #206bc4;
      --primary-hover: #1a569d;
      --secondary: #626976;
      --secondary-hover: #4e545e;
      --success: #2fb344;
      --warning: #f76707;
      --danger: #d63939;
      --muted: #6b7280;
      --bg-color: #f6f8fb;
      --card-bg: #ffffff;
      --border-color: #e6e8e9;
      --text-color: #1d273b;
      --sidebar-width: 240px;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 0;
      background-color: var(--bg-color);
      color: var(--text-color);
      display: flex;
      min-height: 100vh;
    }

    /* Sidebar Layout */
    .sidebar {
      width: var(--sidebar-width);
      background-color: var(--card-bg);
      border-right: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      position: fixed;
      height: 100vh;
      z-index: 10;
    }

    .sidebar-header {
      padding: 1rem 1.5rem;
      border-bottom: 1px solid var(--border-color);
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--primary);
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .sidebar-nav {
      flex: 1;
      padding: 1rem 0;
      overflow-y: auto;
    }

    .nav-item {
      padding: 0.75rem 1.5rem;
      display: block;
      color: var(--text-color);
      text-decoration: none;
      font-weight: 500;
      cursor: pointer;
      transition: background-color 0.2s;
    }

    .nav-item:hover, .nav-item.active {
      background-color: rgba(32, 107, 196, 0.05);
      color: var(--primary);
    }

    /* Main Content */
    .main-wrapper {
      flex: 1;
      margin-left: var(--sidebar-width);
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    /* Top Bar */
    .top-bar {
      background-color: var(--card-bg);
      border-bottom: 1px solid var(--border-color);
      padding: 0.75rem 1.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 5;
      font-size: 0.875rem;
      box-shadow: 0 1px 2px rgba(0,0,0,0.02);
    }

    .top-bar-stats {
      display: flex;
      gap: 1.5rem;
      color: var(--secondary);
    }

    .content-container {
      padding: 1.5rem;
      max-width: 1400px;
      margin: 0 auto;
      width: 100%;
      box-sizing: border-box;
    }

    /* Cards */
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
      margin-bottom: 1.5rem;
      overflow: hidden;
    }

    .card-header {
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .card-title {
      margin: 0;
      font-size: 1.125rem;
      font-weight: 600;
      color: var(--text-color);
    }

    .card-body {
      padding: 1.5rem;
    }

    /* Buttons */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0.5rem 1rem;
      font-size: 0.875rem;
      font-weight: 500;
      border-radius: 6px;
      border: 1px solid transparent;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-sm {
      padding: 0.25rem 0.5rem;
      font-size: 0.75rem;
    }

    .btn-primary { background-color: var(--primary); color: white; }
    .btn-primary:hover { background-color: var(--primary-hover); }
    
    .btn-secondary { background-color: var(--card-bg); color: var(--text-color); border-color: var(--border-color); }
    .btn-secondary:hover { background-color: var(--bg-color); }
    
    .btn-success { background-color: var(--success); color: white; }
    .btn-warning { background-color: var(--warning); color: white; }
    .btn-danger { background-color: var(--danger); color: white; }

    .btn:disabled { opacity: 0.6; cursor: not-allowed; }

    /* Badges */
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 0.25rem 0.5rem;
      font-size: 0.75rem;
      font-weight: 600;
      border-radius: 4px;
      line-height: 1;
    }

    .badge-primary { background-color: rgba(32, 107, 196, 0.1); color: var(--primary); }
    .badge-success { background-color: rgba(47, 179, 68, 0.1); color: var(--success); }
    .badge-warning { background-color: rgba(247, 103, 7, 0.1); color: var(--warning); }
    .badge-danger { background-color: rgba(214, 57, 57, 0.1); color: var(--danger); }
    .badge-neutral { background-color: var(--bg-color); color: var(--secondary); border: 1px solid var(--border-color); }

    /* Layout Grids */
    .grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 1.5rem; }
    .grid-4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem; }

    /* Tables */
    .table-responsive { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
    th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid var(--border-color); }
    th { font-weight: 600; color: var(--secondary); background-color: rgba(246, 248, 251, 0.5); }
    tr:last-child td { border-bottom: none; }

    /* Inputs */
    .form-control {
      display: block;
      width: 100%;
      padding: 0.5rem 0.75rem;
      font-size: 0.875rem;
      line-height: 1.5;
      color: var(--text-color);
      background-color: #fff;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      box-sizing: border-box;
      transition: border-color 0.15s ease-in-out;
    }
    .form-control:focus {
      outline: none;
      border-color: var(--primary);
    }

    .empty-state {
      padding: 3rem 1.5rem;
      text-align: center;
      color: var(--muted);
      font-size: 0.9rem;
    }

    /* Auth Overlay */
    #auth-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: var(--bg-color);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }
    
    .auth-box {
      background: var(--card-bg);
      padding: 2rem;
      border-radius: 12px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.05);
      width: 100%;
      max-width: 400px;
      text-align: center;
    }

    .section { display: none; }
    .section.active { display: block; }

    /* Toast */
    #toast-container {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 9999;
    }
    .toast {
      background: var(--card-bg);
      border: 1px solid var(--border-color);
      border-left: 4px solid var(--primary);
      padding: 15px 20px;
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      margin-top: 10px;
      font-size: 0.9rem;
      animation: slideIn 0.3s ease-out;
    }
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  </style>
</head>
<body>

  <!-- Auth Overlay -->
  <div id="auth-overlay">
    <div class="auth-box border">
      <h2 style="margin-top:0;">NOW OS Login</h2>
      <p style="color:var(--muted); font-size:0.9rem; margin-bottom: 20px;">Owner operasyon paneline erişmek için yetkili admin token giriniz.</p>
      <input type="password" id="token-input" class="form-control" placeholder="DASHBOARD_ADMIN_TOKEN" style="margin-bottom:15px; text-align:center;">
      <button class="btn btn-primary" style="width:100%;" id="save-token-btn">Giriş Yap</button>
      <div id="auth-error" style="color:var(--danger); font-size:0.8rem; margin-top:10px; display:none;">Token hatalı veya eksik.</div>
    </div>
  </div>

  <!-- Sidebar Navigation -->
  <aside class="sidebar">
    <div class="sidebar-header">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"></path><path d="M12 12l8-4.5"></path><path d="M12 12v9"></path><path d="M12 12L4 7.5"></path></svg>
      NOW OS
    </div>
    <nav class="sidebar-nav">
      <a class="nav-item active" onclick="switchTab('sec-overview')">Genel Bakış</a>
      <a class="nav-item" onclick="switchTab('sec-queue')">Takipler</a>
      <a class="nav-item" onclick="switchTab('sec-social')">Sosyal Lead</a>
      <a class="nav-item" onclick="switchTab('sec-learning')">Öğrenme</a>
      <a class="nav-item" onclick="switchTab('sec-wa-learning')">Eğitim & Jargon</a>
      <a class="nav-item" onclick="switchTab('sec-wa-visual')">Görsel Araştırma</a>

      <a class="nav-item" onclick="switchTab('sec-publishers')">Yayıncılar</a>
      <a class="nav-item" onclick="switchTab('sec-reports')">Raporlar</a>
      <a class="nav-item" onclick="switchTab('sec-analytics')">Analitik</a>
      <a class="nav-item" onclick="switchTab('sec-system')">Sistem</a>
    </nav>
  </aside>

  <!-- Main Content -->
  <div class="main-wrapper">
    
    <!-- Top Status Bar -->
    <header class="top-bar">
      <div><strong>Hazırlık:</strong> <span id="top-status">Kontrol ediliyor...</span></div>
      <div class="top-bar-stats">
        <span id="top-backup">Yedek: -</span>
        <span id="top-queue">Açık Takip: -</span>
        <span id="top-social">Sosyal Lead: -</span>
        <span id="top-learning">Öğrenme: -</span>
        <button class="btn btn-secondary btn-sm" onclick="fetchDashboard()">Verileri Yenile</button>
      </div>
    </header>

    <div class="content-container">
      
      <!-- GENEL BAKIŞ -->
      <div id="sec-overview" class="section active">
        <div class="card">
          <div class="card-header"><h2 class="card-title">Operasyon Özeti</h2></div>
          <div class="card-body">
            <div class="grid-4">
              <!-- Sistem -->
              <div style="border: 1px solid var(--border-color); border-radius: 8px; padding: 15px;">
                <div style="font-size:0.8rem; color:var(--muted); margin-bottom:5px;">Sistem Durumu</div>
                <div id="overview-system" style="font-size:1.5rem; font-weight:bold;">-</div>
              </div>
              <!-- Aday -->
              <div style="border: 1px solid var(--border-color); border-radius: 8px; padding: 15px;">
                <div style="font-size:0.8rem; color:var(--muted); margin-bottom:5px;">Günlük Aday İşlemi</div>
                <div id="overview-candidates" style="font-size:1.5rem; font-weight:bold;">-</div>
              </div>
              <!-- Takipler -->
              <div style="border: 1px solid var(--border-color); border-radius: 8px; padding: 15px;">
                <div style="font-size:0.8rem; color:var(--muted); margin-bottom:5px;">Açık Takipler</div>
                <div id="overview-queue" style="font-size:1.5rem; font-weight:bold;">-</div>
              </div>
              <!-- Yedek -->
              <div style="border: 1px solid var(--border-color); border-radius: 8px; padding: 15px;">
                <div style="font-size:0.8rem; color:var(--muted); margin-bottom:5px;">Son Yedek</div>
                <div id="overview-backup" style="font-size:1rem; font-weight:bold; margin-top:5px;">-</div>
              </div>
            </div>
          </div>
        </div>

        <div class="grid-2">
          <div class="card">
            <div class="card-header"><h2 class="card-title">Günlük Rapor Özeti</h2></div>
            <div class="card-body" id="daily-report-content">Yükleniyor...</div>
          </div>
          <div class="card">
            <div class="card-header"><h2 class="card-title">Kuyruk Özeti</h2></div>
            <div class="card-body" id="queue-summary-content">Yükleniyor...</div>
          </div>
        </div>

        <div class="card border-danger">
          <div class="card-header"><h2 class="card-title text-danger">Blokajlar & Öneriler</h2></div>
          <div class="card-body" id="actions-content">Yükleniyor...</div>
        </div>
      </div>

      <!-- TAKİPLER (QUEUE) -->
      <div id="sec-queue" class="section">
        <div class="card">
          <div class="card-header"><h2 class="card-title">Açık Takipler (İlk 10)</h2></div>
          <div class="table-responsive" id="queue-items-container">
            <div class="empty-state">Yükleniyor...</div>
          </div>
        </div>
      </div>

      <!-- SOSYAL LEAD (SOCIAL INTAKE) -->
      <div id="sec-social" class="section">
        <div class="card">
          <div class="card-header"><h2 class="card-title">Sosyal Lead Girişi — Instagram / TikTok</h2></div>
          <div class="card-body">
            <p style="font-size: 0.85rem; color: var(--muted); margin-top:0;">Instagram/TikTok canlı bağlı değildir. JSON veya kopyala-yapıştır ile lead içeri alınır.</p>
            <div id="social-intake-summary" style="margin-bottom: 20px;">Yükleniyor...</div>
            
            <div style="background: var(--bg-color); padding: 1.5rem; border-radius: 8px; border: 1px solid var(--border-color);">
              <h3 style="margin-top:0; font-size:1rem;">İçe Aktar (Manual)</h3>
              <div class="grid-2">
                <div>
                  <select id="import-platform" class="form-control" style="margin-bottom: 10px;">
                    <option value="instagram">Instagram</option>
                    <option value="tiktok">TikTok</option>
                  </select>
                  <textarea id="import-json-textarea" class="form-control" style="height: 120px; font-family: monospace; resize:vertical; margin-bottom:10px;" placeholder="[{ &quot;username&quot;: &quot;...&quot;, &quot;message&quot;: &quot;...&quot; }]"></textarea>
                  <div style="display: flex; gap: 10px;">
                    <button class="btn btn-primary" onclick="importSocialLeads()">İçe Aktar</button>
                    <button class="btn btn-secondary" onclick="fetchSocialLeads()">Listeyi Yenile</button>
                  </div>
                  <div id="import-status" style="margin-top: 10px; font-weight: 500; font-size: 0.85rem;"></div>
                </div>
                <div style="font-size: 0.8rem; background: #fff; padding: 15px; border: 1px solid var(--border-color); border-radius:6px;">
                  <strong>Örnek Şablon:</strong>
                  <pre style="margin: 5px 0 0 0; background:transparent; color: var(--secondary);">[
  {
    "platform": "instagram",
    "username": "ornek_kullanici",
    "display_name": "Örnek Kullanıcı",
    "message": "Merhaba bilgi almak istiyorum",
    "source_label_safe": "instagram_dm",
    "campaign_safe_ref": "CAMPAIGN-INSTAGRAM-001"
  }
]</pre>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h2 class="card-title">Onay Bekleyen Sosyal Leadler (Pending Review)</h2></div>
          <div class="table-responsive" id="social-leads-list">
            <div class="empty-state">Yükleniyor...</div>
          </div>
        </div>
      </div>

      <!-- ÖĞRENME -->
      
      <div id="sec-wa-visual" class="section">
        <h2>WhatsApp Görsel Araştırma (SPEC-030C)</h2>
        <p style="font-size:0.85rem; color:var(--muted); margin-top:-10px; margin-bottom:20px;">Bu alan sadece araştırma/context içindir. Otomatik öğrenme veya Knowledge Bank güncellemesi yapmaz.</p>
        <div class="grid-2">
          <div class="card">
            <div class="card-header"><h2 class="card-title">Araştırma Yükle</h2></div>
            <div class="card-body">
              <input type="text" id="wvr-source-label" class="form-control" style="margin-bottom:10px;" placeholder="Kaynak (örn: group_export_1)">
              
              <div style="margin-bottom:10px;">
                <label style="font-size:0.85rem; font-weight:600; display:block; margin-bottom:5px;">Yükleme Yöntemi:</label>
                <select id="wvr-upload-method" class="form-control" style="margin-bottom:10px;" onchange="toggleWvrUploadMethod()">
                  <option value="file">ZIP Dosyası Yükle (Max 50MB)</option>
                  <option value="local">Sunucu Local Path (Debug/Owner)</option>
                </select>
              </div>

              <div id="wvr-file-input-container">
                <input type="file" id="wvr-file-input" class="form-control" accept=".zip" style="margin-bottom:10px;">
              </div>
              <div id="wvr-local-input-container" style="display:none;">
                <input type="text" id="wvr-local-path" class="form-control" style="margin-bottom:10px;" placeholder="C:/temp/chat.zip">
              </div>

              <div style="font-size:0.85rem; margin-bottom:15px; color:var(--danger); background:rgba(214,57,57,0.1); padding:10px; border-radius:4px;">
                <strong>DİKKAT:</strong> Bu işlem hassas veriler içerebilecek görselleri geçici olarak tarar. Sadece güvendiğiniz kaynakları yükleyin.
              </div>
              
              <label style="display:flex; align-items:center; gap:8px; font-size:0.85rem; margin-bottom:15px; cursor:pointer;">
                <input type="checkbox" id="wvr-confirm">
                Onaylıyorum (Research-only modunda işlenecek)
              </label>

              <button class="btn btn-primary" style="width:100%;" onclick="importWvrZip()">Görselleri Analiz Et</button>
              <div id="wvr-import-status" style="margin-top:10px; font-size:0.85rem; font-weight:500;"></div>
            </div>
          </div>
          <div class="card">
            <div class="card-header">
              <h2 class="card-title">Araştırma Özeti</h2>
              <button class="btn btn-secondary btn-sm" onclick="fetchWvrData()">Yenile</button>
            </div>
            <div class="card-body" id="wvr-summary-container">
              Yükleniyor...
            </div>
          </div>
        </div>

        <div class="card" style="margin-top:1.5rem;">
          <div class="card-header"><h2 class="card-title">Araştırma Bulguları (Sanitize Edilmiş)</h2></div>
          <div class="table-responsive" id="wvr-items-container">
            <div class="empty-state">Yükleniyor...</div>
          </div>
        </div>
      </div>

      <div id="sec-wa-learning" class="section">
        <h2>WhatsApp Eğitim & Jargon (SPEC-030)</h2>
        <div class="grid">
          <div class="card">
            <div class="card-title">İçe Aktar</div>
            <p style="font-size:0.85rem; color:var(--muted); margin-bottom:15px;">WhatsApp History Export veya manuel metin yapıştırın.</p>
            <select id="wa-source-type" class="form-control" style="margin-bottom:10px;">
              <option value="copy_paste">Kopyala-Yapıştır</option>
              <option value="whatsapp_export">WhatsApp Export (.txt)</option>
              <option value="evolution_history">Evolution JSON</option>
            </select>
            <textarea id="wa-import-text" class="form-control" style="height:150px; margin-bottom:10px;" placeholder="WhatsApp mesajları veya JSON buraya..."></textarea>
            <button class="btn btn-primary" onclick="importWaLearning()">Metni İçe Aktar</button>
            <div id="wa-import-status" style="margin-top:10px; font-size:0.85rem; font-weight:500;"></div>
          </div>
          
          <div class="card">
            <div class="card-title">Özet Metrikler</div>
            <div id="wa-summary-content" style="font-size:0.9rem; line-height:1.5;">Yükleniyor...</div>
            <hr style="margin:15px 0; border:none; border-top:1px solid #e5e7eb;">
            <button class="btn btn-primary" style="width:100%;" onclick="generateWaSuggestions()">Bekleyen Suggestion Üret</button>
            <div id="wa-gen-status" style="margin-top:10px; font-size:0.85rem; font-weight:500; text-align:center;"></div>
            <p style="font-size:0.8rem; color:var(--muted); margin-top:10px;">Üretilen suggestion'lar Öğrenme sekmesine (SPEC-024D) düşer.</p>
          </div>
        </div>
      </div>

      <div id="sec-learning" class="section">
        <div class="card">
          <div class="card-header"><h2 class="card-title">Onay Bekleyen Eğitim Önerileri (Learning Review)</h2></div>
          <div class="table-responsive" id="learning-items-container">
            <div class="empty-state">Yükleniyor...</div>
          </div>
        </div>
      </div>

      <!-- YAYINCILAR -->
      <div id="sec-publishers" class="section">
        <div class="card">
          <div class="card-header"><h2 class="card-title">Yayıncılar / Personel</h2></div>
          <div class="table-responsive" id="publishers-container">
            <div class="empty-state">Yükleniyor...</div>
          </div>
        </div>
      </div>

      <!-- RAPORLAR (SCHEDULED) -->
      <div id="sec-reports" class="section">
        <div class="card">
          <div class="card-header"><h2 class="card-title">Zamanlı Günlük Raporlar</h2></div>
          <div class="card-body">
            <div id="scheduled-report-config">Yükleniyor...</div>
            <div style="margin-top: 20px; display: flex; gap: 10px;">
              <button class="btn btn-primary" onclick="triggerScheduledReportPreview()">Manuel Önizleme</button>
              <button class="btn btn-warning" onclick="triggerScheduledReportSend()">Manuel Gönderim (Owner)</button>
            </div>
            
            <h3 style="margin-top:30px; font-size:1rem; border-bottom:1px solid var(--border-color); padding-bottom:5px;">Rapor Geçmişi</h3>
            <div class="table-responsive" id="scheduled-report-runs">Yükleniyor...</div>
          </div>
        </div>
      </div>

      <!-- ANALİTİK -->
      <div id="sec-analytics" class="section">
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Operasyon Performansı</h2>
            <div>
              <select id="analytics-period" class="form-control" style="display:inline-block; width:auto; padding: 4px 8px; font-size:0.85rem;" onchange="fetchAnalytics()">
                <option value="today">Bugün</option>
                <option value="7d" selected>Son 7 Gün</option>
                <option value="30d">Son 30 Gün</option>
              </select>
              <button class="btn btn-secondary btn-sm" onclick="fetchAnalytics()">Yenile</button>
            </div>
          </div>
          <div class="card-body" id="analytics-content">Yükleniyor...</div>
        </div>
      </div>

      <!-- SİSTEM KONTROLLERİ -->
      <div id="sec-system" class="section">
        <div class="card">
          <div class="card-header"><h2 class="card-title">Sistem Kontrolleri & Güvenlik</h2></div>
          <div class="card-body">
            <div style="display: flex; gap: 10px; flex-wrap: wrap;">
              <button class="btn btn-primary" onclick="runAction('/dashboard/actions/daily-report/generate', false)">Günlük Rapor Oluştur</button>
              <button class="btn btn-warning" onclick="runAction('/dashboard/actions/queue/resolve', true)">Kuyruk Temizle (Dry-Run)</button>
              <button class="btn btn-danger" onclick="runAction('/dashboard/actions/learning/review', true)">Eğitim Onay (Dry-Run)</button>
              <button class="btn btn-danger" onclick="runMaintenanceAction('on')">Bakıma Al</button>
              <button class="btn btn-warning" onclick="runMaintenanceAction('off')">Bakımdan Çıkar</button>
              <button class="btn btn-secondary" onclick="runBackupAction()">Yedek Al</button>
              <button class="btn btn-secondary" onclick="fetchAuditLog()">Denetim Günlüğü Göster</button>
            </div>
            <pre id="audit-log-content" style="display: none; margin-top: 20px; background: var(--bg-color); padding: 15px; border-radius: 8px; border: 1px solid var(--border-color); overflow: auto; max-height: 400px; font-size:0.8rem;"></pre>
          </div>
        </div>
      </div>

    </div>
  </div>

  <div id="toast-container"></div>

  <script>
    const STORAGE_KEY = 'now_os_dashboard_token';
    const queueReasonMap = {
      'ready_for_installation_followup': 'Kurulum için takip gerekli',
      'installation_not_started': 'Kurulum başlamadı',
      'support_signal': 'Destek sinyali',
      'training_not_completed': 'Eğitim tamamlanmadı',
      'installation_stuck': 'Kurulumda takıldı',
      'group_support_signal': 'Grup desteği gerekli',
      'missing_selected_app': 'Uygulama seçimi eksik',
      'payment_or_trust_question': 'Ödeme/güven sorusu',
      'unknown': 'Genel takip'
    };

    function escapeHtml(unsafe) {
      if (typeof unsafe !== 'string') return '';
      return unsafe
           .replace(/&/g, "&amp;")
           .replace(/</g, "&lt;")
           .replace(/>/g, "&gt;")
           .replace(/"/g, "&quot;")
           .replace(/'/g, "&#039;");
    }

    function getToken() { return localStorage.getItem(STORAGE_KEY); }

    function showToast(message, type = 'success') {
      const container = document.getElementById('toast-container');
      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.style.borderLeftColor = type === 'error' ? 'var(--danger)' : type === 'warning' ? 'var(--warning)' : 'var(--success)';
      toast.innerText = message;
      container.appendChild(toast);
      setTimeout(() => { toast.remove(); }, 4000);
    }

    function switchTab(sectionId) {
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.getElementById(sectionId).classList.add('active');
      event.currentTarget.classList.add('active');
    }

    document.getElementById('save-token-btn').addEventListener('click', () => {
      const token = document.getElementById('token-input').value;
      if (token) {
        localStorage.setItem(STORAGE_KEY, token);
        document.getElementById('auth-error').style.display = 'none';
        fetchDashboard();
      } else {
        document.getElementById('auth-error').style.display = 'block';
      }
    });

    function init() {
      const token = getToken();
      if (token) {
        fetchDashboard();
      } else {
        document.getElementById('auth-overlay').style.display = 'flex';
      }
    }

    async function fetchDashboard() {
      const token = getToken();
      if (!token) return;

      try {
        const response = await fetch('/dashboard/summary', {
          headers: { 'x-dashboard-token': token }
        });

        if (response.status === 401 || response.status === 403) {
          throw new Error('Yetkisiz erişim.');
        }
        if (!response.ok) throw new Error('Sunucu hatası: ' + response.status);

        const data = await response.json();
        
        // Hide auth, show UI
        document.getElementById('auth-overlay').style.display = 'none';
        
        // document.getElementById('last-refresh').innerText = 'Son Güncelleme: ' + new Date().toLocaleTimeString();

        renderDashboard(data);
        fetchSocialSummary();
        fetchSocialLeads();
        fetchWaSummary();
        fetchAnalytics();
        fetchScheduledReportsConfig();

      } catch (err) {
        document.getElementById('auth-overlay').style.display = 'flex';
        document.getElementById('auth-error').innerText = err.message;
        document.getElementById('auth-error').style.display = 'block';
        localStorage.removeItem(STORAGE_KEY);
      }
    }

    
    async function fetchWaSummary() {
      const token = getToken();
      if (!token) return;
      try {
        const res = await fetch('/dashboard/whatsapp-learning/summary', { headers: { 'x-dashboard-token': token } });
        if (res.ok) {
          const data = await res.json();
          document.getElementById('wa-summary-content').innerHTML = 
            '<div style=\"display:grid; grid-template-columns:1fr 1fr; gap:10px;\">' +
              '<div style=\"background:#f9fafb; padding:10px; border-radius:6px; border:1px solid #e5e7eb;\">' +
                '<div style=\"font-size:0.75rem; color:#6b7280;\">Toplam Mesaj</div>' +
                '<div style=\"font-size:1.2rem; font-weight:600;\">' + data.total + '</div>' +
              '</div>' +
              '<div style=\"background:#f9fafb; padding:10px; border-radius:6px; border:1px solid #e5e7eb;\">' +
                '<div style=\"font-size:0.75rem; color:#6b7280;\">Jargon Tespitleri</div>' +
                '<div style=\"font-size:1.2rem; font-weight:600;\">' + data.jargon_count + '</div>' +
              '</div>' +
              '<div style=\"background:#f9fafb; padding:10px; border-radius:6px; border:1px solid #e5e7eb;\">' +
                '<div style=\"font-size:0.75rem; color:#6b7280;\">Sık Sorulan (FAQ)</div>' +
                '<div style=\"font-size:1.2rem; font-weight:600;\">' + data.faq_count + '</div>' +
              '</div>' +
              '<div style=\"background:#f9fafb; padding:10px; border-radius:6px; border:1px solid #e5e7eb;\">' +
                '<div style=\"font-size:0.75rem; color:#6b7280;\">İtirazlar</div>' +
                '<div style=\"font-size:1.2rem; font-weight:600;\">' + data.objection_count + '</div>' +
              '</div>' +
            '</div>';
        }
      } catch (err) {}
    }

    async function importWaLearning() {
      const token = getToken();
      if (!token) return;
      const text = document.getElementById('wa-import-text').value;
      const type = document.getElementById('wa-source-type').value;
      if (!text) return showToast('Metin giriniz.', 'error');
      
      document.getElementById('wa-import-status').innerText = 'Aktarılıyor...';
      try {
        const res = await fetch('/dashboard/actions/whatsapp-learning/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-dashboard-token': token, 'x-idempotency-key': 'idp-' + Date.now() },
          body: JSON.stringify({ content: text, source_type: type, source_label_safe: 'manual_wa_' + Date.now(), confirm: true })
        });
        const data = await res.json();
        if (res.ok) {
          showToast('İçe aktarıldı. Aktarılan: ' + data.imported_count, 'success');
          document.getElementById('wa-import-status').innerText = 'Başarılı: ' + data.imported_count + ' mesaj (Atlanan kopya: ' + data.skipped_duplicate_count + ')';
          document.getElementById('wa-import-text').value = '';
          fetchWaSummary();
        } else {
          showToast(data.error || 'Hata', 'error');
          document.getElementById('wa-import-status').innerText = 'Hata: ' + (data.error || 'Bilinmiyor');
        }
      } catch (err) {
        showToast(err.message, 'error');
      }
    }

    async function generateWaSuggestions() {
      const token = getToken();
      if (!token) return;
      document.getElementById('wa-gen-status').innerText = 'Üretiliyor...';
      try {
        const res = await fetch('/dashboard/actions/whatsapp-learning/generate-suggestions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-dashboard-token': token, 'x-idempotency-key': 'idp-' + Date.now() },
          body: JSON.stringify({ confirm: true })
        });
        const data = await res.json();
        if (res.ok) {
          showToast('Üretildi: ' + data.generated_count, 'success');
          document.getElementById('wa-gen-status').innerText = 'Başarılı: ' + data.generated_count + ' yeni suggestion (Kopya: ' + data.skipped_duplicate_count + ')';
          fetchDashboard(); // refresh all to get the new items in learning tab
        } else {
          showToast(data.error || 'Hata', 'error');
          document.getElementById('wa-gen-status').innerText = 'Hata: ' + (data.error || 'Bilinmiyor');
        }
      } catch (err) {
        showToast(err.message, 'error');
      }
    }

    function renderDashboard(data) {
      const isOnline = data.system_status === 'online';
      
      // Top Bar Stats
      document.getElementById('top-status').innerHTML = isOnline ? '<span class="badge badge-success">Online</span>' : '<span class="badge badge-warning">Bakım Modu</span>';
      document.getElementById('top-backup').innerText = 'Yedek: ' + (data.backup_status?.status === 'success' ? 'OK' : 'Bilinmiyor');
      document.getElementById('top-queue').innerText = 'Açık Takip: ' + (data.queue_summary?.open_queue_count || 0);
      
      // Overview Cards
      document.getElementById('overview-system').innerHTML = isOnline ? '<span style="color:var(--success)">Online</span>' : '<span style="color:var(--warning)">Bakım</span>';
      document.getElementById('overview-candidates').innerText = data.daily_report_summary?.total_candidates || 0;
      document.getElementById('overview-queue').innerText = data.queue_summary?.open_queue_count || 0;
      document.getElementById('overview-backup').innerText = data.backup_status?.status === 'success' ? 'Başarılı' : 'Bilinmiyor';

      // Daily Report Content
      document.getElementById('daily-report-content').innerHTML = \`
        <ul style="list-style:none; padding:0; margin:0; line-height:1.8;">
          <li><span style="color:var(--muted); display:inline-block; width:150px;">Toplam Aday:</span> <strong>\${data.daily_report_summary?.total_candidates || 0}</strong></li>
          <li><span style="color:var(--muted); display:inline-block; width:150px;">Açık Takip:</span> <strong>\${data.daily_report_summary?.open_follow_up_count || 0}</strong></li>
          <li><span style="color:var(--muted); display:inline-block; width:150px;">Yüksek Öncelikli:</span> <span class="badge badge-danger">\${data.daily_report_summary?.high_priority_count || 0}</span></li>
        </ul>
      \`;

      // Queue Summary Content
      document.getElementById('queue-summary-content').innerHTML = \`
        <ul style="list-style:none; padding:0; margin:0; line-height:1.8;">
          <li><span style="color:var(--muted); display:inline-block; width:150px;">Kuyruk Açık:</span> <strong>\${data.queue_summary?.open_queue_count || 0}</strong></li>
          <li><span style="color:var(--muted); display:inline-block; width:150px;">Kuyruk Çözüldü:</span> <span class="badge badge-success">\${data.queue_summary?.resolved_queue_count || 0}</span></li>
          <li><span style="color:var(--muted); display:inline-block; width:150px;">Bilgi Eksik (Aday):</span> <strong>\${data.candidate_summary?.missing_info_count || 0}</strong></li>
        </ul>
      \`;

      // Blockers & Actions
      let blockersHtml = '<div class="empty-state">Aktif blokaj yok</div>';
      if (data.blockers && data.blockers.length > 0) {
        blockersHtml = '<ul style="color:var(--danger); padding-left:20px; font-weight:500;">' + data.blockers.map(b => \`<li>\${escapeHtml(b)}</li>\`).join('') + '</ul>';
      }
      let actionsHtml = '';
      if (data.suggested_actions && data.suggested_actions.length > 0) {
        actionsHtml = '<div style="margin-top:1rem; font-weight:600; color:var(--text-color);">Öneriler:</div><ul style="padding-left:20px; color:var(--secondary);">' + data.suggested_actions.map(a => \`<li>\${escapeHtml(a)}</li>\`).join('') + '</ul>';
      }
      document.getElementById('actions-content').innerHTML = blockersHtml + actionsHtml;

      // Queue Items List (İlk 10)
      const qContainer = document.getElementById('queue-items-container');
      if (data.queue_items && data.queue_items.length > 0) {
        let html = '<table><thead><tr><th>ID</th><th>Öncelik</th><th>Açıklama</th><th>Tarih</th><th>İşlem</th></tr></thead><tbody>';
        data.queue_items.slice(0, 10).forEach(item => {
          let badgeClass = 'badge-neutral';
          if (item.priority === 'HIGH') badgeClass = 'badge-danger';
          if (item.priority === 'MEDIUM') badgeClass = 'badge-warning';
          if (item.priority === 'LOW') badgeClass = 'badge-success';
          
          let reason = queueReasonMap[item.reason] || escapeHtml(item.reason);
          html += \`<tr>
            <td><strong>\${escapeHtml(item.safe_ref)}</strong></td>
            <td><span class="badge \${badgeClass}">\${escapeHtml(item.priority)}</span></td>
            <td>\${reason}</td>
            <td style="color:var(--muted); font-size:0.8rem;">\${escapeHtml(item.last_seen_at)}</td>
            <td><button class="btn btn-primary btn-sm" onclick="runQueueResolve('\${escapeHtml(item.safe_ref)}')">Çözüldü</button></td>
          </tr>\`;
        });
        html += '</tbody></table>';
        if (data.queue_items.length > 10) {
          html += \`<div style="text-align:center; padding:10px; color:var(--muted); font-size:0.85rem;">+ \${data.queue_items.length - 10} kayıt daha var.</div>\`;
        }
        qContainer.innerHTML = html;
      } else {
        qContainer.innerHTML = '<div class="empty-state">Kayıt yok.</div>';
      }

      // Publishers
      const pContainer = document.getElementById('publishers-container');
      if (data.publishers && data.publishers.length > 0) {
        let html = '<table><thead><tr><th>Yayıncı</th><th>Durum</th><th>Son Güncelleme</th><th>İşlem</th></tr></thead><tbody>';
        data.publishers.forEach(pub => {
          let badgeClass = pub.activity_status === 'active' ? 'badge-success' : 'badge-neutral';
          html += \`<tr>
            <td><strong>\${escapeHtml(pub.display_name)}</strong> <div style="font-size:0.75rem;color:var(--muted);">\${escapeHtml(pub.safe_ref)}</div></td>
            <td><span class="badge \${badgeClass}">\${escapeHtml(pub.activity_status)}</span></td>
            <td style="color:var(--muted); font-size:0.8rem;">\${escapeHtml(pub.updated_at)}</td>
            <td>
              <select id="status-select-\${escapeHtml(pub.safe_ref)}" class="form-control" style="display:inline-block; width:auto; padding:0.25rem 0.5rem; font-size:0.8rem; margin-right:5px;">
                <option value="active" \${pub.activity_status === 'active' ? 'selected' : ''}>active</option>
                <option value="inactive" \${pub.activity_status === 'inactive' ? 'selected' : ''}>inactive</option>
                <option value="training_pending" \${pub.activity_status === 'training_pending' ? 'selected' : ''}>training_pending</option>
                <option value="installation_pending" \${pub.activity_status === 'installation_pending' ? 'selected' : ''}>installation_pending</option>
                <option value="support_needed" \${pub.activity_status === 'support_needed' ? 'selected' : ''}>support_needed</option>
                <option value="paused" \${pub.activity_status === 'paused' ? 'selected' : ''}>paused</option>
              </select>
              <button class="btn btn-secondary btn-sm" onclick="runPublisherUpdate('\${escapeHtml(pub.safe_ref)}')">Güncelle</button>
            </td>
          </tr>\`;
        });
        html += '</tbody></table>';
        pContainer.innerHTML = html;
      } else {
        pContainer.innerHTML = '<div class="empty-state">Kayıt yok.</div>';
      }

      // Learning
      const lContainer = document.getElementById('learning-items-container');
      if (data.pending_learning_items && data.pending_learning_items.length > 0) {
        document.getElementById('top-learning').innerText = 'Öğrenme: ' + data.pending_learning_items.length;
        let html = '<table><thead><tr><th>ID</th><th>Kategori</th><th>Öneri</th><th>İşlem</th></tr></thead><tbody>';
        data.pending_learning_items.forEach(item => {
          html += \`<tr>
            <td><strong>\${escapeHtml(item.safe_ref)}</strong></td>
            <td><span class="badge badge-primary">\${escapeHtml(item.suggestion_class)}</span></td>
            <td>\${escapeHtml(item.proposed_text_sanitized)}</td>
            <td style="white-space:nowrap;">
              <button class="btn btn-success btn-sm" onclick="runLearningReview('\${escapeHtml(item.safe_ref)}', 'approve')">Onayla</button>
              <button class="btn btn-danger btn-sm" onclick="runLearningReview('\${escapeHtml(item.safe_ref)}', 'reject')">Reddet</button>
            </td>
          </tr>\`;
        });
        html += '</tbody></table>';
        lContainer.innerHTML = html;
      } else {
        document.getElementById('top-learning').innerText = 'Öğrenme: 0';
        lContainer.innerHTML = '<div class="empty-state">Kayıt yok.</div>';
      }
    }

    async function fetchSocialSummary() {
      const token = getToken();
      if (!token) return;
      const container = document.getElementById('social-intake-summary');
      try {
        const res = await fetch('/dashboard/social-intake/summary', { headers: { 'x-dashboard-token': token } });
        if (!res.ok) throw new Error("API hatası");
        const data = await res.json();
        
        document.getElementById('top-social').innerText = 'Sosyal Lead: ' + (data.total_pending_review || 0);

        container.innerHTML = \`
          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <span class="badge badge-neutral" style="font-size:0.85rem; padding:0.5rem 0.75rem;">Toplam: \${data.total_leads || 0}</span>
            <span class="badge badge-warning" style="font-size:0.85rem; padding:0.5rem 0.75rem;">Onay Bekleyen: \${data.total_pending_review || 0}</span>
            <span class="badge badge-success" style="font-size:0.85rem; padding:0.5rem 0.75rem;">Dönüşen (Converted): \${data.total_converted || 0}</span>
            <span class="badge badge-neutral" style="font-size:0.85rem; padding:0.5rem 0.75rem;">Arşiv: \${data.total_archived || 0}</span>
            <span class="badge badge-danger" style="font-size:0.85rem; padding:0.5rem 0.75rem;">Kopya Engellenen: \${data.total_duplicates_blocked || 0}</span>
          </div>
          <div style="margin-top:10px; font-size:0.85rem; color:var(--secondary);">
            <strong>Platform Dağılımı:</strong> Instagram: \${data.platform_breakdown?.instagram || 0} | TikTok: \${data.platform_breakdown?.tiktok || 0}
          </div>
        \`;
      } catch (err) {
        container.innerHTML = '<div class="empty-state" style="color:var(--danger);">Veri alınamadı: ' + escapeHtml(err.message) + '</div>';
      }
    }

    async function fetchSocialLeads() {
      const token = getToken();
      if (!token) return;
      const container = document.getElementById('social-leads-list');
      container.innerHTML = '<div class="empty-state">Yükleniyor...</div>';
      try {
        const res = await fetch('/dashboard/social-intake/leads?status=pending_review', { headers: { 'x-dashboard-token': token } });
        if (!res.ok) throw new Error("API hatası");
        const data = await res.json();
        
        if (!data || data.length === 0) {
          container.innerHTML = '<div class="empty-state">Onay bekleyen kayıt yok.</div>';
          return;
        }

        let html = '<table><thead><tr><th>Platform</th><th>Lead Ref</th><th>Kampanya</th><th>Kişi</th><th>Mesaj Özeti</th><th>İşlem</th></tr></thead><tbody>';
        data.forEach(lead => {
          let pBadge = lead.platform === 'instagram' ? 'badge-warning' : 'badge-primary';
          html += \`<tr>
            <td><span class="badge \${pBadge}">\${escapeHtml(lead.platform)}</span></td>
            <td><strong>\${escapeHtml(lead.lead_ref)}</strong></td>
            <td style="color:var(--muted); font-size:0.8rem;">\${escapeHtml(lead.campaign_safe_ref || '-')}</td>
            <td>\${escapeHtml(lead.display_name_sanitized)}</td>
            <td style="max-width:250px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--secondary);">\${escapeHtml(lead.message_preview_sanitized)}</td>
            <td style="white-space:nowrap;">
              <button class="btn btn-success btn-sm" onclick="convertSocialLead('\${escapeHtml(lead.lead_ref)}')">Convert</button>
              <button class="btn btn-secondary btn-sm" onclick="archiveSocialLead('\${escapeHtml(lead.lead_ref)}')">Archive</button>
            </td>
          </tr>\`;
        });
        html += '</tbody></table>';
        container.innerHTML = html;
      } catch (err) {
        container.innerHTML = '<div class="empty-state" style="color:var(--danger);">Veri alınamadı: ' + escapeHtml(err.message) + '</div>';
      }
    }

    async function importSocialLeads() {
      const token = getToken();
      if (!token) return;
      const platform = document.getElementById('import-platform').value;
      const jsonStr = document.getElementById('import-json-textarea').value;
      const statusEl = document.getElementById('import-status');
      
      if (!jsonStr.trim()) {
        statusEl.innerText = 'Lütfen JSON verisi girin.';
        statusEl.style.color = 'var(--danger)';
        return;
      }

      statusEl.innerText = 'İçeri alınıyor...';
      statusEl.style.color = 'var(--warning)';

      try {
        const payload = JSON.parse(jsonStr);
        const res = await fetch('/dashboard/actions/social-intake/import', {
          method: 'POST',
          headers: { 
            'x-dashboard-token': token,
            'x-idempotency-key': generateIdempotencyKey(),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ confirm: true, platform, source_type: 'manual_json', payload })
        });
        
        const data = await res.json();
        if (res.ok) {
          statusEl.innerText = \`Başarılı. \${data.imported_count} eklendi, \${data.duplicate_count} kopya.\`;
          statusEl.style.color = 'var(--success)';
          document.getElementById('import-json-textarea').value = '';
          fetchSocialSummary();
          fetchSocialLeads();
          showToast(\`Lead eklendi: \${data.imported_count}\`);
        } else {
          statusEl.innerText = 'Hata: ' + escapeHtml(data.error);
          statusEl.style.color = 'var(--danger)';
        }
      } catch (err) {
        statusEl.innerText = 'Format veya İstek hatası: ' + escapeHtml(err.message);
        statusEl.style.color = 'var(--danger)';
      }
    }

    async function convertSocialLead(lead_ref) {
      if (!confirm('Bu adayı Candidate havuzuna aktarmak istediğinize emin misiniz?')) return;
      showToast('Convert özelliği V1 backend implementasyonunda desteklenmiyor.', 'warning');
    }
    
    async function archiveSocialLead(lead_ref) {
      if (!confirm('Arşivlemek istediğinize emin misiniz?')) return;
      showToast('Archive özelliği V1 backend implementasyonunda desteklenmiyor.', 'warning');
    }

    async function fetchAnalytics() {
      const token = getToken();
      if (!token) return;
      const period = document.getElementById('analytics-period').value;
      const el = document.getElementById('analytics-content');
      el.innerHTML = '<div class="empty-state">Yükleniyor...</div>';
      try {
        const res = await fetch('/dashboard/analytics/summary?period=' + period, { headers: { 'x-dashboard-token': token } });
        if (!res.ok) throw new Error("API hatası");
        const data = await res.json();
        
        let healthClass = data.health_score.status === 'good' ? 'var(--success)' : data.health_score.status === 'watch' ? 'var(--warning)' : 'var(--danger)';
        
        let html = \`
          <div style="display:flex; gap:1.5rem; margin-bottom:1.5rem; flex-wrap:wrap;">
            <div style="background:var(--card-bg); border: 2px solid \${healthClass}; border-radius:12px; padding:1.5rem; width:200px; text-align:center;">
              <div style="font-size:0.9rem; color:var(--muted); margin-bottom:10px; font-weight:600;">Health Score</div>
              <div style="font-size:3rem; font-weight:800; color:\${healthClass}; line-height:1;">\${data.health_score.score}</div>
            </div>
            
            <div style="flex:1; background:var(--bg-color); border: 1px solid var(--border-color); border-radius:12px; padding:1.5rem;">
              <h3 style="margin-top:0; font-size:1rem; color:var(--text-color);">Odaklanılması Gereken Alanlar</h3>
              \${data.suggested_focus_areas.length > 0 
                ? '<ul style="margin:0; padding-left:20px; font-size:0.9rem; color:var(--secondary); line-height:1.6;">' + data.suggested_focus_areas.map(s => '<li>' + escapeHtml(s) + '</li>').join('') + '</ul>'
                : '<div class="empty-state" style="padding:1rem;">Öneri yok, her şey yolunda görünüyor.</div>'
              }
            </div>
          </div>
          
          <div class="grid-4">
            <div style="border: 1px solid var(--border-color); border-radius: 8px; padding: 15px;">
              <h4 style="margin:0 0 10px 0; font-size:0.95rem; color:var(--text-color);">Aday Hunisi</h4>
              <ul style="margin:0; padding-left:20px; font-size:0.85rem; color:var(--secondary); line-height:1.6;">
                <li>Toplam: \${data.candidate_metrics.total_candidates}</li>
                <li>Aktif: \${data.candidate_metrics.active_candidates}</li>
                <li>Red/Block: \${data.candidate_metrics.blocked_rejected_count}</li>
              </ul>
            </div>
            <div style="border: 1px solid var(--border-color); border-radius: 8px; padding: 15px;">
              <h4 style="margin:0 0 10px 0; font-size:0.95rem; color:var(--text-color);">Yayıncı Durumu</h4>
              <ul style="margin:0; padding-left:20px; font-size:0.85rem; color:var(--secondary); line-height:1.6;">
                <li>Toplam: \${data.publisher_metrics.total_publishers}</li>
                <li>Destek Lazım: \${data.publisher_metrics.support_needed_count}</li>
              </ul>
            </div>
            <div style="border: 1px solid var(--border-color); border-radius: 8px; padding: 15px;">
              <h4 style="margin:0 0 10px 0; font-size:0.95rem; color:var(--text-color);">Kuyruk (Queue)</h4>
              <ul style="margin:0; padding-left:20px; font-size:0.85rem; color:var(--secondary); line-height:1.6;">
                <li>Açık: \${data.queue_metrics.open_queue_count}</li>
                <li>Gecikmiş: \${data.queue_metrics.overdue_followups_count}</li>
              </ul>
            </div>
            <div style="border: 1px solid var(--border-color); border-radius: 8px; padding: 15px;">
              <h4 style="margin:0 0 10px 0; font-size:0.95rem; color:var(--text-color);">Raporlar & Öğrenme</h4>
              <ul style="margin:0; padding-left:20px; font-size:0.85rem; color:var(--secondary); line-height:1.6;">
                <li>Zamanlı Rapor: \${data.report_metrics.scheduled_report_runs}</li>
                <li>Hatalı Rapor: \${data.report_metrics.failed_count}</li>
              </ul>
            </div>
          </div>
          <div style="margin-top:1.5rem; font-size:0.8rem; color:var(--muted); font-style:italic;">
            * İçe aktarılmış uygulama performans (revenue/coin) verisi yok. Sadece operasyonel metrikler hesaplanır.
          </div>
        \`;
        el.innerHTML = html;
      } catch (err) {
        el.innerHTML = '<div class="empty-state" style="color:var(--danger);">Veri alınamadı: ' + escapeHtml(err.message) + '</div>';
      }
    }

    async function fetchScheduledReportsConfig() {
      const configEl = document.getElementById('scheduled-report-config');
      const runsEl = document.getElementById('scheduled-report-runs');
      const token = getToken();
      if (!token) return;
      try {
        const [configRes, runsRes] = await Promise.all([
          fetch('/dashboard/scheduled-reports/config', { headers: { 'x-dashboard-token': token } }),
          fetch('/dashboard/scheduled-reports/runs', { headers: { 'x-dashboard-token': token } })
        ]);
        
        if (configRes.ok) {
          const config = await configRes.json();
          configEl.innerHTML = \`
            <div style="background:var(--bg-color); border:1px solid var(--border-color); border-radius:8px; padding:15px; display:inline-block; min-width:300px;">
              <ul style="list-style:none; padding:0; margin:0; font-size:0.9rem; line-height:1.8;">
                <li><strong>Durum:</strong> \${config.enabled ? '<span class="badge badge-success">AÇIK</span>' : '<span class="badge badge-danger">KAPALI</span>'}</li>
                <li><strong>Zaman:</strong> \${String(config.configured_hour).padStart(2, '0')}:\${String(config.configured_minute).padStart(2, '0')} (\${config.timezone})</li>
                <li><strong>Mod:</strong> \${escapeHtml(config.delivery_mode)}</li>
                <li><strong>Dry-Run (Güvenli Mod):</strong> \${config.dry_run ? 'EVET' : 'HAYIR'}</li>
                <li><strong>Otomatik WhatsApp:</strong> \${config.send_whatsapp ? 'EVET' : 'HAYIR'}</li>
              </ul>
            </div>
          \`;
        } else {
          configEl.innerHTML = '<div class="empty-state">Kayıt yok veya yapılandırılmadı.</div>';
        }
        
        if (runsRes.ok) {
          const { runs } = await runsRes.json();
          if (runs && runs.length > 0) {
            let html = '<table><thead><tr><th>Zaman</th><th>Tip</th><th>Statü</th><th>Hata (Varsa)</th></tr></thead><tbody>';
            runs.forEach(r => {
              let statBadge = r.status === 'sent' || r.status === 'generated' ? 'badge-success' : (r.status === 'failed' ? 'badge-danger' : 'badge-neutral');
              html += \`<tr>
                <td style="color:var(--muted); font-size:0.8rem;">\${escapeHtml(r.generated_at)}</td>
                <td>\${escapeHtml(r.trigger_type)} <span style="font-size:0.75rem; color:var(--muted);">(\${escapeHtml(r.target_mode)})</span></td>
                <td><span class="badge \${statBadge}">\${escapeHtml(r.status)}</span></td>
                <td style="color:var(--danger); font-size:0.8rem;">\${escapeHtml(r.error_sanitized || '-')}</td>
              </tr>\`;
            });
            html += '</tbody></table>';
            runsEl.innerHTML = html;
          } else {
            runsEl.innerHTML = '<div class="empty-state">Henüz rapor çalışmadı.</div>';
          }
        }
      } catch (err) {
        configEl.innerHTML = '<div class="empty-state" style="color:var(--danger);">Veri alınamadı: ' + escapeHtml(err.message) + '</div>';
        runsEl.innerHTML = '';
      }
    }

    async function triggerScheduledReportPreview() {
      const token = getToken();
      if (!token) return;
      const res = await fetch('/dashboard/actions/scheduled-reports/run-preview', {
        method: 'POST',
        headers: { 'x-dashboard-token': token, 'x-idempotency-key': generateIdempotencyKey() }
      });
      const data = await res.json();
      if (res.ok) {
        alert("Önizleme başarılı! Durum: " + data.run.status + "\\n\\n" + data.run.report_preview_sanitized);
        fetchScheduledReportsConfig();
        showToast('Önizleme oluşturuldu.');
      } else {
        alert("Hata: " + escapeHtml(data.error));
      }
    }

    async function triggerScheduledReportSend() {
      const token = getToken();
      if (!token) return;
      if (!confirm("Raporu çalıştırmak ve göndermek istediğinize emin misiniz?")) return;
      
      const res = await fetch('/dashboard/actions/scheduled-reports/run-send', {
        method: 'POST',
        headers: { 
          'x-dashboard-token': token, 
          'x-idempotency-key': generateIdempotencyKey(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ confirm: true })
      });
      const data = await res.json();
      if (res.ok) {
        alert("Gönderim başarılı! Durum: " + data.run.status);
        fetchScheduledReportsConfig();
        showToast('Rapor gönderildi.');
      } else {
        alert("Bu işlem sadece owner yetkisiyle yapılabilir. \\n(Hata: " + escapeHtml(data.error) + ")");
      }
    }

    function generateIdempotencyKey() {
      return Math.random().toString(36).substring(2) + Date.now().toString(36);
    }

    async function runAction(endpoint, requiresConfirm, extraPayload = {}) {
      const token = getToken();
      if (!token) return;
      if (requiresConfirm && !confirm("Bu işlemi yapmak istediğinize emin misiniz?")) return;
      
      showToast('İşleniyor...', 'warning');
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 
            'x-dashboard-token': token,
            'x-idempotency-key': generateIdempotencyKey(),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ confirm: requiresConfirm, ...extraPayload })
        });
        const data = await res.json();
        
        if (res.ok) {
          showToast(data.message, 'success');
          setTimeout(fetchDashboard, 1000);
        } else {
          showToast(data.error || "Başarısız", 'error');
        }
      } catch (err) {
        showToast('Hata: ' + err.message, 'error');
      }
    }

    async function runMaintenanceAction(state) {
      const reason = prompt("Bakım modu için açıklama (opsiyonel):");
      if (reason === null) return;
      await runAction('/dashboard/actions/maintenance', true, { desired_state: state, reason });
    }

    async function runQueueResolve(safeRef) {
      const reason = prompt(safeRef + " kaydını çözmek için açıklama (opsiyonel):");
      if (reason === null) return;
      await runAction('/dashboard/actions/queue/resolve', true, { queue_ref: safeRef, reason });
    }

    async function runLearningReview(safeRef, decision) {
      const reason = prompt(safeRef + " işlemi için açıklama (opsiyonel):");
      if (reason === null) return;
      await runAction('/dashboard/actions/learning/review', true, { learning_ref: safeRef, decision, reason });
    }

    async function runPublisherUpdate(safeRef) {
      const select = document.getElementById('status-select-' + safeRef);
      const newStatus = select.value;
      const reason = prompt(safeRef + " statüsünü " + newStatus + " yapmak için açıklama:");
      if (reason === null) return;
      await runAction('/dashboard/actions/publisher/status', true, { publisher_ref: safeRef, status: newStatus, reason });
    }

    async function runBackupAction() {
      const reason = prompt("Yedekleme için açıklama:");
      if (reason === null) return;
      await runAction('/dashboard/actions/backup/run', true, { reason });
    }

    async function fetchAuditLog() {
      const token = getToken();
      if (!token) return;
      const el = document.getElementById('audit-log-content');
      el.style.display = 'block';
      el.innerText = "Yükleniyor...";
      try {
        const res = await fetch('/dashboard/actions/audit', { headers: { 'x-dashboard-token': token } });
        const data = await res.json();
        // Fallback: This is the only place we keep JSON stringify as it's a raw system log viewer for admin
        el.innerText = JSON.stringify(data.logs, null, 2);
      } catch (err) {
        el.innerText = "Hata: " + err.message;
      }
    }
    
    // ==========================================
    // WHATSAPP VISUAL RESEARCH
    // ==========================================

    function toggleWvrUploadMethod() {
      const method = document.getElementById('wvr-upload-method').value;
      if (method === 'file') {
        document.getElementById('wvr-file-input-container').style.display = 'block';
        document.getElementById('wvr-local-input-container').style.display = 'none';
      } else {
        document.getElementById('wvr-file-input-container').style.display = 'none';
        document.getElementById('wvr-local-input-container').style.display = 'block';
      }
    }

    async function importWvrZip() {
      const token = getToken();
      if (!token) return;
      const sourceLabel = document.getElementById('wvr-source-label').value.trim();
      const method = document.getElementById('wvr-upload-method').value;
      const confirmChecked = document.getElementById('wvr-confirm').checked;
      const statusEl = document.getElementById('wvr-import-status');
      
      if (!sourceLabel) {
        statusEl.innerText = "Kaynak etiketi (source_label) zorunludur.";
        statusEl.style.color = "var(--danger)";
        return;
      }
      if (!confirmChecked) {
        statusEl.innerText = "İşlemi onaylamanız gerekiyor.";
        statusEl.style.color = "var(--danger)";
        return;
      }

      statusEl.innerText = "Yükleniyor ve işleniyor (Lütfen bekleyin)...";
      statusEl.style.color = "var(--primary)";

      try {
        let res;
        if (method === 'file') {
          const fileInput = document.getElementById('wvr-file-input');
          if (fileInput.files.length === 0) {
            statusEl.innerText = "Lütfen bir ZIP dosyası seçin.";
            statusEl.style.color = "var(--danger)";
            return;
          }
          const formData = new FormData();
          formData.append("zip_file", fileInput.files[0]);
          formData.append("source_label_safe", sourceLabel);
          formData.append("mode", "research_only");
          formData.append("confirm", "true");
          
          res = await fetch('/dashboard/actions/whatsapp-visual-research/import', {
            method: 'POST',
            headers: { 
              'x-dashboard-token': token,
              'x-idempotency-key': generateIdempotencyKey()
            },
            body: formData
          });
        } else {
          const localPath = document.getElementById('wvr-local-path').value.trim();
          if (!localPath) {
            statusEl.innerText = "Local path zorunludur.";
            statusEl.style.color = "var(--danger)";
            return;
          }
          res = await fetch('/dashboard/actions/whatsapp-visual-research/import', {
            method: 'POST',
            headers: { 
              'x-dashboard-token': token,
              'x-idempotency-key': generateIdempotencyKey(),
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              source_label_safe: sourceLabel,
              mode: "research_only",
              confirm: true,
              local_path: localPath
            })
          });
        }

        const data = await res.json();
        if (res.ok) {
          statusEl.innerText = "Araştırma başarıyla tamamlandı! Özeti yenileyin.";
          statusEl.style.color = "var(--success)";
          fetchWvrData();
        } else {
          statusEl.innerText = "Hata: " + escapeHtml(data.error || "İşlem başarısız");
          statusEl.style.color = "var(--danger)";
        }
      } catch (err) {
        statusEl.innerText = "Hata: " + err.message;
        statusEl.style.color = "var(--danger)";
      }
    }

    async function fetchWvrData() {
      const token = getToken();
      if (!token) return;
      const summaryEl = document.getElementById('wvr-summary-container');
      const itemsEl = document.getElementById('wvr-items-container');
      
      try {
        const res = await fetch('/dashboard/api/whatsapp-visual-research', { headers: { 'x-dashboard-token': token } });
        const data = await res.json();
        
        if (!res.ok) throw new Error(data.error);

        // Render Summary
        summaryEl.innerHTML = \`
          <ul style="list-style:none; padding:0; margin:0; line-height:1.8;">
            <li><strong>Toplam Kayıt:</strong> \${data.summary.total_items}</li>
            <li><strong>İşlenen Görsel:</strong> \${data.summary.processed_images}</li>
            <li><strong>Atlanan Medya:</strong> \${data.summary.skipped_media}</li>
            <li><strong style="color:var(--danger)">Hassas/Özel İçerik:</strong> \${data.summary.sensitive_risk_count}</li>
          </ul>
          <hr style="border:0; border-top:1px solid var(--border-color); margin:10px 0;">
          <ul style="list-style:none; padding:0; margin:0; line-height:1.8;">
            <li><span class="badge badge-primary">Kurulum:</span> \${data.summary.setup_screen_count}</li>
            <li><span class="badge badge-success">Ödeme/Çekim:</span> \${data.summary.payment_screen_count}</li>
            <li><span class="badge badge-danger">Hata:</span> \${data.summary.error_screen_count}</li>
            <li><span class="badge badge-warning">Davet:</span> \${data.summary.invite_code_screen_count}</li>
            <li><span class="badge badge-neutral">Profil Ekranı:</span> \${data.summary.profile_screen_count}</li>
            <li><span class="badge badge-neutral">İlgisiz Fotoğraf:</span> \${data.summary.unrelated_photo_count}</li>
          </ul>
        \`;

        // Render Items
        if (data.items && data.items.length > 0) {
          // reverse sort (newest first)
          const sorted = data.items.sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
          
          let html = '<table><thead><tr><th>Ref & Kaynak</th><th>Kategori</th><th>Bağlam (Context)</th><th>Durum</th><th>İşlem</th></tr></thead><tbody>';
          sorted.forEach(item => {
            let catBadge = 'badge-neutral';
            if (item.visual_category === 'app_setup_screen') catBadge = 'badge-primary';
            else if (item.visual_category === 'payment_withdrawal_screen') catBadge = 'badge-success';
            else if (item.visual_category === 'error_screen') catBadge = 'badge-danger';
            
            let contextPreview = item.nearby_context_sanitized.join(" | ");
            if (contextPreview.length > 100) contextPreview = contextPreview.substring(0, 100) + '...';
            if (!contextPreview) contextPreview = '<em>(Metin bulunamadı)</em>';
            
            const riskLabels = item.risk_flags.length > 0 ? \`<span style="color:var(--danger);font-size:0.7rem;display:block;">⚠️ \${escapeHtml(item.risk_flags.join(','))}</span>\` : '';
            const skipLabel = item.skip_reason ? \`<span style="color:var(--warning);font-size:0.7rem;display:block;">Atlandı: \${escapeHtml(item.skip_reason)}</span>\` : '';

            html += \`<tr>
              <td>
                <div style="font-weight:600;">\${escapeHtml(item.visual_ref)}</div>
                <div style="font-size:0.75rem; color:var(--muted);">\${escapeHtml(item.source_label_safe)} / \${escapeHtml(item.file_name_safe)}</div>
              </td>
              <td><span class="badge \${catBadge}">\${escapeHtml(item.visual_category)}</span></td>
              <td style="font-size:0.8rem; max-width:300px;">
                \${escapeHtml(contextPreview)}
                \${riskLabels}
                \${skipLabel}
              </td>
              <td style="font-size:0.8rem; color:var(--muted);">
                \${escapeHtml(new Date(item.created_at).toLocaleString())}
              </td>
              <td>
                \${!item.skip_reason && !item.risk_flags.includes('sensitive_private_info') ? 
                  \`<button class="btn btn-secondary btn-sm" onclick="createWvrDraftLearning('\${item.visual_ref}')">Draft Suggestion Oluştur</button>\` : 
                  '<em style="font-size:0.75rem; color:var(--muted);">İşlem Yapılamaz</em>'
                }
              </td>
            </tr>\`;
          });
          html += '</tbody></table>';
          itemsEl.innerHTML = html;
        } else {
          itemsEl.innerHTML = '<div class="empty-state">Henüz araştırma bulgusu yok.</div>';
        }
      } catch (err) {
        summaryEl.innerHTML = '<span style="color:var(--danger)">Hata: ' + escapeHtml(err.message) + '</span>';
        itemsEl.innerHTML = '<div class="empty-state" style="color:var(--danger)">Bulgular yüklenemedi.</div>';
      }
    }

    async function createWvrDraftLearning(ref) {
      if (!confirm(ref + " referanslı görsel bağlamı için Taslak Öğrenme Önerisi (Pending Review) oluşturmak istiyor musunuz? (Knowledge Bank otomatik GÜNCELLENMEZ, sadece taslak oluşturulur)")) return;
      await runAction('/dashboard/actions/whatsapp-visual-research/' + ref + '/draft-learning', false);
    }
    
    // Start automatically
    init();
  </script>
</body>
</html>
`;

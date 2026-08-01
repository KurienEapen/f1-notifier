document.addEventListener('DOMContentLoaded', () => {
  const configForm = document.getElementById('configForm');
  const telegramBotToken = document.getElementById('telegramBotToken');
  const telegramChatId = document.getElementById('telegramChatId');
  const cronSchedule = document.getElementById('cronSchedule');
  const discordWebhookUrl = document.getElementById('discordWebhookUrl');
  const targetsList = document.getElementById('targetsList');
  const logsTableBody = document.getElementById('logsTableBody');

  const btnCheckNow = document.getElementById('btnCheckNow');
  const btnTestTelegram = document.getElementById('btnTestTelegram');
  const btnClearLogs = document.getElementById('btnClearLogs');

  const statTelegramStatus = document.getElementById('statTelegramStatus');
  const statCronSchedule = document.getElementById('statCronSchedule');
  const statTargetCount = document.getElementById('statTargetCount');

  let currentConfig = null;

  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  async function loadConfig() {
    try {
      const res = await fetch('/api/config');
      const config = await res.json();
      currentConfig = config;

      telegramBotToken.value = config.telegramBotToken || '';
      telegramChatId.value = config.telegramChatId || '';
      cronSchedule.value = config.cronSchedule || '*/5 * * * *';
      discordWebhookUrl.value = config.discordWebhookUrl || '';

      statCronSchedule.textContent = config.cronSchedule || '*/5 * * * *';
      statTargetCount.textContent = `${config.targets.length} Outlets`;

      if (config.telegramBotToken && config.telegramChatId) {
        statTelegramStatus.textContent = 'Configured';
        statTelegramStatus.className = 'card-value badge badge-success';
      } else {
        statTelegramStatus.textContent = 'Missing Token/Chat ID';
        statTelegramStatus.className = 'card-value badge badge-warning';
      }

      renderTargets(config.targets);
    } catch (err) {
      console.error('Error loading config:', err);
      showToast('Failed to load configuration from server', 'error');
    }
  }

  function renderTargets(targets) {
    if (!targets || targets.length === 0) {
      targetsList.innerHTML = '<p class="text-muted">No monitored outlets configured.</p>';
      return;
    }

    targetsList.innerHTML = targets.map(t => {
      let badgeClass = 'badge-warning';
      let statusLabel = 'WAITING';

      if (t.lastStatus === 'AVAILABLE') {
        badgeClass = 'badge-success';
        statusLabel = 'TICKETS OPEN!';
      } else if (t.lastStatus === 'ERROR') {
        badgeClass = 'badge-danger';
        statusLabel = 'ERROR';
      }

      const lastCheckedStr = t.lastChecked ? new Date(t.lastChecked).toLocaleTimeString() : 'Not yet checked';

      return `
        <div class="target-item">
          <div>
            <div class="target-title">${t.name}</div>
            <a href="${t.url}" target="_blank" rel="noopener" class="target-url">${t.url}</a>
            <div style="margin-top: 4px; font-size: 0.75rem;" class="text-muted">
              Last checked: ${lastCheckedStr}
            </div>
          </div>
          <div style="text-align: right;">
            <span class="badge ${badgeClass}">${statusLabel}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  async function loadLogs() {
    try {
      const res = await fetch('/api/logs?limit=30');
      const logs = await res.json();

      if (!logs || logs.length === 0) {
        logsTableBody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">No activity logs recorded yet.</td></tr>';
        return;
      }

      logsTableBody.innerHTML = logs.map(log => {
        let badgeClass = 'badge-info';
        if (log.status === 'AVAILABLE') badgeClass = 'badge-success';
        if (log.status === 'WAITING') badgeClass = 'badge-warning';
        if (log.status === 'ERROR') badgeClass = 'badge-danger';

        const dateStr = new Date(log.timestamp).toLocaleString();

        return `
          <tr>
            <td class="font-mono" style="font-size: 0.8rem;">${dateStr}</td>
            <td><strong>${log.targetName}</strong></td>
            <td><span class="badge ${badgeClass}">${log.status}</span></td>
            <td>${log.message}</td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      console.error('Error loading logs:', err);
    }
  }

  // Event Handlers
  configForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentConfig) return;

    const updatedConfig = {
      ...currentConfig,
      telegramBotToken: telegramBotToken.value.trim(),
      telegramChatId: telegramChatId.value.trim(),
      cronSchedule: cronSchedule.value.trim(),
      discordWebhookUrl: discordWebhookUrl.value.trim()
    };

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedConfig)
      });
      const data = await res.json();
      if (data.success) {
        showToast('Settings saved successfully!', 'success');
        loadConfig();
        loadLogs();
      } else {
        showToast(data.message || 'Failed to save settings', 'error');
      }
    } catch (err) {
      showToast('Server connection error', 'error');
    }
  });

  btnTestTelegram.addEventListener('click', async () => {
    btnTestTelegram.disabled = true;
    btnTestTelegram.innerHTML = '<span>⏳</span> Sending Test...';
    try {
      const res = await fetch('/api/test-telegram', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
      } else {
        showToast(data.message, 'error');
      }
    } catch (err) {
      showToast('Error communicating with Telegram API', 'error');
    } finally {
      btnTestTelegram.disabled = false;
      btnTestTelegram.innerHTML = '<span>🚀</span> Test Telegram Alert';
      loadLogs();
    }
  });

  btnCheckNow.addEventListener('click', async () => {
    btnCheckNow.disabled = true;
    btnCheckNow.innerHTML = '<span class="icon">⏳</span> Checking Sites...';
    try {
      const res = await fetch('/api/check-now', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
        await loadConfig();
        await loadLogs();
      } else {
        showToast(data.message || 'Check failed', 'error');
      }
    } catch (err) {
      showToast('Error triggering manual check', 'error');
    } finally {
      btnCheckNow.disabled = false;
      btnCheckNow.innerHTML = '<span class="icon">🔄</span> Run Check Now';
    }
  });

  btnClearLogs.addEventListener('click', () => {
    loadLogs();
    showToast('Activity log feed refreshed', 'info');
  });

  // Initial load & Polling interval
  loadConfig();
  loadLogs();
  setInterval(loadLogs, 8000);
});

import React, { useEffect, useRef, useState } from 'react';
import { Building2, Camera, CreditCard, MapPin, MonitorSmartphone, Phone, Save } from 'lucide-react';
import { toast } from 'react-toastify';
import SidebarMenu from '../../../Components/SidebarMenu/SidebarMenu';
import { useAuth } from '../../../context/AuthContext';
import apiService from '../../../services/apiService';
import './TenantSettings.css';

const activationUrl = token => `${window.location.origin}/ingreso?mode=kiosk#token=${encodeURIComponent(token)}`;
const tabs = [
  { id: 'profile', label: 'Identidad y contacto', icon: Building2 },
  { id: 'payments', label: 'Cobros', icon: CreditCard },
  { id: 'kiosks', label: 'Kioscos', icon: MonitorSmartphone },
];

const TenantSettings = () => {
  const { tenant, refresh } = useAuth();
  const fileInput = useRef(null);
  const [activeTab, setActiveTab] = useState('profile');
  const [saving, setSaving] = useState(false);
  const [logo, setLogo] = useState(null);
  const [logoPreview, setLogoPreview] = useState(tenant?.settings?.logoUrl || '');
  const [profile, setProfile] = useState({
    name: tenant?.name || '', primaryColor: tenant?.settings?.primaryColor || '#DA4632',
    contactPhone: tenant?.settings?.contactPhone || '', contactEmail: tenant?.settings?.contactEmail || '',
    location: tenant?.settings?.location || '',
  });
  const [payments, setPayments] = useState({
    paymentAccountHolder: tenant?.settings?.paymentAccountHolder || '', paymentAlias: tenant?.settings?.paymentAlias || '',
    paymentCbu: tenant?.settings?.paymentCbu || '', paymentTaxId: tenant?.settings?.paymentTaxId || '',
    paymentWhatsapp: tenant?.settings?.paymentWhatsapp || '',
  });
  const [kiosks, setKiosks] = useState([]);
  const [label, setLabel] = useState('Recepción');
  const [secret, setSecret] = useState(() => sessionStorage.getItem('newKioskActivationToken'));

  const loadKiosks = async () => {
    try { setKiosks(await apiService.getKioskCredentials()); }
    catch (error) { toast.error(error.message || 'No pudimos cargar los kioscos.'); }
  };

  useEffect(() => { sessionStorage.removeItem('newKioskActivationToken'); loadKiosks(); }, []);
  useEffect(() => () => { if (logo && logoPreview) URL.revokeObjectURL(logoPreview); }, [logo, logoPreview]);

  const selectLogo = event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      toast.error('Elegí un logo PNG, JPG o WebP de hasta 5 MB.'); return;
    }
    if (logo && logoPreview) URL.revokeObjectURL(logoPreview);
    setLogo(file); setLogoPreview(URL.createObjectURL(file));
  };

  const saveProfile = async event => {
    event.preventDefault(); setSaving(true);
    try {
      const body = new FormData();
      Object.entries(profile).forEach(([key, value]) => body.append(key, value));
      if (logo) body.append('logo', logo);
      const result = await apiService.updateTenantProfile(body);
      await refresh();
      setLogoPreview(result.settings?.logoUrl || '');
      setLogo(null);
      toast.success('Perfil del gimnasio actualizado.');
    } catch (error) { toast.error(error.message || 'No pudimos actualizar el perfil.'); }
    finally { setSaving(false); }
  };

  const savePayments = async event => {
    event.preventDefault(); setSaving(true);
    try { await apiService.updateTenantSettings(payments); await refresh(); toast.success('Datos de cobro actualizados.'); }
    catch (error) { toast.error(error.message || 'No pudimos guardar los datos de cobro.'); }
    finally { setSaving(false); }
  };

  const createKiosk = async event => {
    event.preventDefault();
    try { const result = await apiService.createKioskCredential(label); setSecret(result.activationToken); await loadKiosks(); }
    catch (error) { toast.error(error.message || 'No pudimos crear la credencial.'); }
  };
  const revoke = async id => { try { await apiService.revokeKioskCredential(id); await loadKiosks(); } catch (error) { toast.error(error.message); } };
  const rotate = async id => { try { const result = await apiService.rotateKioskCredential(id); setSecret(result.activationToken); await loadKiosks(); } catch (error) { toast.error(error.message); } };
  const copy = async () => { await navigator.clipboard.writeText(activationUrl(secret)); toast.success('URL copiada.'); };

  return (
    <div className="tenant-settings-page">
      <SidebarMenu isAdmin />
      <main className="tenant-settings-content">
        <header className="settings-heading"><div><span>Perfil del gimnasio</span><h1>Configuración</h1><p>Administrá la identidad y preferencias de {tenant?.name}.</p></div><code>{tenant?.slug}</code></header>
        <nav className="settings-tabs" aria-label="Secciones de configuración">
          {tabs.map(({ id, label: tabLabel, icon: Icon }) => <button key={id} className={activeTab === id ? 'active' : ''} onClick={() => setActiveTab(id)}><Icon size={15} />{tabLabel}</button>)}
        </nav>

        {activeTab === 'profile' && <form className="settings-panel" onSubmit={saveProfile}>
          <div className="settings-section-heading"><div><h2>Identidad del gimnasio</h2><p>Se muestra en el menú y en documentos del sistema.</p></div></div>
          <div className="settings-logo-row">
            <div className="settings-logo-preview">{logoPreview ? <img src={logoPreview} alt={`Logo de ${profile.name}`} /> : <Building2 size={26} />}</div>
            <div><strong>Logo del gimnasio</strong><small>PNG, JPG o WebP · Máximo 5 MB</small></div>
            <button className="settings-logo-action" type="button" onClick={() => fileInput.current?.click()}><Camera size={14} /> Cambiar logo</button>
            <input ref={fileInput} className="settings-logo-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={selectLogo} />
          </div>
          <div className="settings-grid settings-grid--brand">
            <label><span>Nombre del gimnasio</span><input value={profile.name} onChange={e => setProfile({ ...profile, name: e.target.value })} required minLength="3" /></label>
            <label><span>Color principal</span><span className="settings-color"><input type="color" value={profile.primaryColor} onChange={e => setProfile({ ...profile, primaryColor: e.target.value })} /><b>{profile.primaryColor.toUpperCase()}</b></span></label>
          </div>
          <div className="settings-separator" />
          <div className="settings-section-heading"><div><h2>Datos de contacto</h2><p>Información pública y administrativa del gimnasio.</p></div></div>
          <div className="settings-grid">
            <label><span>Celular</span><span className="settings-icon-input"><Phone size={14} /><input value={profile.contactPhone} onChange={e => setProfile({ ...profile, contactPhone: e.target.value })} required /></span></label>
            <label><span>Email de contacto <small>Opcional</small></span><input type="email" value={profile.contactEmail} onChange={e => setProfile({ ...profile, contactEmail: e.target.value })} /></label>
            <label className="settings-full"><span>Ubicación <small>Opcional</small></span><span className="settings-icon-input"><MapPin size={14} /><input value={profile.location} onChange={e => setProfile({ ...profile, location: e.target.value })} /></span></label>
          </div>
          <div className="settings-actions"><span>Los cambios se aplicarán a toda la cuenta.</span><button className="settings-save" disabled={saving}><Save size={15} />{saving ? 'Guardando...' : 'Guardar cambios'}</button></div>
        </form>}

        {activeTab === 'payments' && <form className="settings-panel" onSubmit={savePayments}>
          <div className="settings-section-heading"><div><h2>Datos de cobro</h2><p>Información que tus socios utilizan para realizar transferencias.</p></div></div>
          <div className="settings-grid">
            {[
              ['paymentAccountHolder', 'Titular de la cuenta'], ['paymentAlias', 'Alias'], ['paymentCbu', 'CBU'],
              ['paymentTaxId', 'CUIL / CUIT'], ['paymentWhatsapp', 'WhatsApp para comprobantes'],
            ].map(([field, fieldLabel]) => <label key={field}><span>{fieldLabel}</span><input value={payments[field]} onChange={e => setPayments({ ...payments, [field]: e.target.value })} /></label>)}
          </div>
          <div className="settings-actions"><span>Todos los campos son opcionales.</span><button className="settings-save" disabled={saving}><Save size={15} />{saving ? 'Guardando...' : 'Guardar cambios'}</button></div>
        </form>}

        {activeTab === 'kiosks' && <section className="settings-panel">
          <div className="settings-section-heading"><div><h2>Dispositivos de ingreso</h2><p>Creá una credencial para cada recepción o punto de acceso.</p></div></div>
          <form className="kiosk-form" onSubmit={createKiosk}><input value={label} onChange={e => setLabel(e.target.value)} placeholder="Ej. Recepción principal" /><button>Crear credencial</button></form>
          {secret && <div className="kiosk-secret"><code>{activationUrl(secret)}</code><button onClick={copy}>Copiar URL</button></div>}
          <ul className="kiosk-list">{kiosks.map(kiosk => <li key={kiosk.id}><span><i className={kiosk.active ? 'active' : ''} />{kiosk.label}<small>{kiosk.active ? 'Activa' : 'Revocada'}</small></span>{kiosk.active && <div><button onClick={() => rotate(kiosk.id)}>Rotar</button><button onClick={() => revoke(kiosk.id)}>Revocar</button></div>}</li>)}</ul>
          {!kiosks.length && <div className="settings-empty"><MonitorSmartphone size={22} /><span>Todavía no hay dispositivos configurados.</span></div>}
        </section>}
      </main>
    </div>
  );
};

export default TenantSettings;

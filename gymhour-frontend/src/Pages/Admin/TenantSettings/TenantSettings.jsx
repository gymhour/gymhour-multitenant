import React, { useEffect, useRef, useState } from 'react';
import { Building2, Camera, Copy, CreditCard, ExternalLink, Mail, MapPin, Phone, Save, ShieldCheck } from 'lucide-react';
import { toast } from 'react-toastify';
import SidebarMenu from '../../../Components/SidebarMenu/SidebarMenu';
import { useAuth } from '../../../context/AuthContext';
import apiService from '../../../services/apiService';
import './TenantSettings.css';

const gymLoginUrl = slug => `${window.location.origin}/${slug}/login`;

const TenantSettings = () => {
  const { tenant, user, refresh } = useAuth();
  const fileInput = useRef(null);
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

  const saveSettings = async event => {
    event.preventDefault(); setSaving(true);
    try {
      const body = new FormData();
      Object.entries(profile).forEach(([key, value]) => body.append(key, value));
      if (logo) body.append('logo', logo);
      const result = await apiService.updateTenantProfile(body);
      await apiService.updateTenantSettings(payments);
      await refresh();
      setLogoPreview(result.settings?.logoUrl || logoPreview);
      setLogo(null);
      toast.success('Configuración actualizada.');
    } catch (error) { toast.error(error.message || 'No pudimos guardar la configuración.'); }
    finally { setSaving(false); }
  };

  const copyLoginUrl = async () => {
    await navigator.clipboard.writeText(gymLoginUrl(tenant.slug));
    toast.success('Enlace de acceso copiado.');
  };

  return (
    <div className="tenant-settings-page">
      <SidebarMenu isAdmin />
      <main className="tenant-settings-content">
        <header className="settings-heading">
          <div><h1>Configuración</h1><p>Gestioná la información principal de {tenant?.name} desde un solo lugar.</p></div>
        </header>

        <form className="settings-surface" onSubmit={saveSettings}>
          <section className="settings-section">
            <div className="settings-section-index">01</div>
            <div className="settings-section-body">
              <div className="settings-section-heading"><div><h2>Cuenta</h2><p>El mail que utilizás para ingresar como administrador.</p></div><ShieldCheck size={19} /></div>
              <label className="settings-field settings-field--full"><span>Mail de acceso</span><span className="settings-icon-input settings-readonly"><Mail size={15} /><input value={user?.email || ''} readOnly aria-readonly="true" /></span><small>Para cambiar este mail, contactate con soporte.</small></label>
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section-index">02</div>
            <div className="settings-section-body">
              <div className="settings-section-heading"><div><h2>Datos de contacto</h2><p>Información administrativa y formas de encontrar tu gimnasio.</p></div></div>
              <div className="settings-grid">
                <label className="settings-field"><span>Número de celular</span><span className="settings-icon-input"><Phone size={15} /><input value={profile.contactPhone} onChange={e => setProfile({ ...profile, contactPhone: e.target.value })} required /></span></label>
                <label className="settings-field"><span>Mail secundario <small>Opcional</small></span><input type="email" value={profile.contactEmail} onChange={e => setProfile({ ...profile, contactEmail: e.target.value })} placeholder="administracion@tugym.com" /></label>
                <label className="settings-field settings-field--full"><span>Ubicación del gimnasio <small>Opcional</small></span><span className="settings-icon-input"><MapPin size={15} /><input value={profile.location} onChange={e => setProfile({ ...profile, location: e.target.value })} placeholder="Dirección, ciudad o provincia" /></span></label>
              </div>
            </div>
          </section>

          <section className="settings-section">
            <div className="settings-section-index">03</div>
            <div className="settings-section-body">
              <div className="settings-section-heading"><div><h2>Datos del gimnasio</h2><p>Identidad que verán tu equipo y tus socios.</p></div><Building2 size={19} /></div>
              <div className="settings-logo-row">
                <div className="settings-logo-preview">{logoPreview ? <img src={logoPreview} alt={`Logo de ${profile.name}`} /> : <Building2 size={26} />}</div>
                <div><strong>Logo del gimnasio</strong><small>PNG, JPG o WebP · Máximo 5 MB</small></div>
                <button className="settings-logo-action" type="button" onClick={() => fileInput.current?.click()}><Camera size={14} /> {logo ? 'Cambiar archivo' : 'Cambiar logo'}</button>
                <input ref={fileInput} className="settings-logo-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={selectLogo} hidden />
              </div>
              <div className="settings-grid settings-grid--brand">
                <label className="settings-field"><span>Nombre del gimnasio</span><input value={profile.name} onChange={e => setProfile({ ...profile, name: e.target.value })} required minLength="3" /></label>
                <label className="settings-field"><span>Color principal</span><span className="settings-color"><input type="color" value={profile.primaryColor} onChange={e => setProfile({ ...profile, primaryColor: e.target.value })} /><b>{profile.primaryColor.toUpperCase()}</b></span></label>
              </div>
              <div className="settings-login-url">
                <div><strong>Enlace de acceso para tus socios</strong><code>{gymLoginUrl(tenant?.slug)}</code></div>
                <button type="button" onClick={copyLoginUrl}><Copy size={14} /> Copiar</button>
                <a href={gymLoginUrl(tenant?.slug)} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Abrir</a>
              </div>

              <div className="settings-subsection-heading"><CreditCard size={17} /><div><h3>Datos de cobro</h3><p>Estos datos les indican a tus socios dónde transferir sus cuotas.</p></div></div>
              <div className="settings-grid">
                {[
                  ['paymentAccountHolder', 'Titular de la cuenta', 'Nombre y apellido o razón social'],
                  ['paymentAlias', 'Alias', 'MI.GIMNASIO'], ['paymentCbu', 'CBU o CVU', '22 dígitos'],
                  ['paymentTaxId', 'CUIL / CUIT', '20-12345678-9'],
                  ['paymentWhatsapp', 'WhatsApp para comprobantes', '5493510000000'],
                ].map(([field, label, placeholder]) => <label className={`settings-field ${field === 'paymentWhatsapp' ? 'settings-field--full' : ''}`} key={field}><span>{label} <small>Opcional</small></span><input value={payments[field]} placeholder={placeholder} onChange={e => setPayments({ ...payments, [field]: e.target.value })} /></label>)}
              </div>
            </div>
          </section>

          <footer className="settings-actions"><span>Los cambios se aplicarán a toda la cuenta.</span><button className="settings-save" disabled={saving}><Save size={16} />{saving ? 'Guardando...' : 'Guardar configuración'}</button></footer>
        </form>
      </main>
    </div>
  );
};

export default TenantSettings;

import React, { useEffect, useRef, useState } from 'react';
import { Check, ImagePlus, MapPin, Phone } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../../../axiosConfig';
import CLIENT_SETUP from '../../../setup';
import { useAuth } from '../../../context/AuthContext';
import './onboarding.css';

const Onboarding = () => {
  const navigate = useNavigate();
  const fileInput = useRef(null);
  const { user, refresh } = useAuth();
  const [form, setForm] = useState({ name: '', primaryColor: '#DA4632', contactPhone: '', contactEmail: '', location: '' });
  const [logo, setLogo] = useState(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const change = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }));
  const selectLogo = event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Elegí un archivo de imagen.'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('El logo no puede superar los 5 MB.'); return; }
    if (preview) URL.revokeObjectURL(preview);
    setLogo(file); setPreview(URL.createObjectURL(file)); setError('');
  };

  const submit = async event => {
    event.preventDefault(); setError('');
    if (!logo) { setError('Subí el logo de tu gimnasio.'); return; }
    setLoading(true);
    try {
      const body = new FormData();
      Object.entries(form).forEach(([key, value]) => body.append(key, value));
      body.append('logo', logo);
      await apiClient.put('/tenant/onboarding', body);
      await refresh();
      navigate('/admin/inicio', { replace: true });
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'No pudimos guardar la configuración. Intentá nuevamente.');
    } finally { setLoading(false); }
  };

  return (
    <main className="onboarding-page">
      <header className="onboarding-header">
        <img src={CLIENT_SETUP.branding.logo} alt={CLIENT_SETUP.branding.logoAlt} />
        <span>Configuración inicial</span>
      </header>
      <div className="onboarding-layout">
        <section className="onboarding-intro">
          <span className="onboarding-step">Paso 2 de 2</span>
          <h1>Configurá tu gimnasio</h1>
          <p>Agregá la información básica de tu espacio. Podrás modificarla más adelante.</p>
        </section>
        <section className="onboarding-card">
          <div className="onboarding-card__title">
            <div><span>Perfil del gimnasio</span><small>{user?.email}</small></div>
            <span className="onboarding-card__status">Cuenta creada <Check size={13} /></span>
          </div>
          <form onSubmit={submit}>
            <div className="onboarding-section">
              <div className="onboarding-section__heading"><strong>Identidad</strong><span>Información visible para tus socios</span></div>
              <div className="logo-row">
              <button className="logo-picker" type="button" onClick={() => fileInput.current?.click()}>
                {preview ? <img src={preview} alt="Vista previa del logo" /> : <ImagePlus size={23} />}
              </button>
              <input ref={fileInput} className="onboarding-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={selectLogo} />
                <div><button type="button" onClick={() => fileInput.current?.click()}>{preview ? 'Cambiar logo' : 'Elegir archivo'}</button><span>PNG, JPG o WebP · Máximo 5 MB</span></div>
              </div>
              <div className="onboarding-fields onboarding-fields--identity">
                <label className="onboarding-field"><span>Nombre del gimnasio</span><input name="name" value={form.name} onChange={change} placeholder="Ej. Distrito Fitness" minLength="3" required /></label>
                <label className="color-field"><span>Color principal</span><span className="color-control"><input type="color" name="primaryColor" value={form.primaryColor} onChange={change} /><b>{form.primaryColor.toUpperCase()}</b></span></label>
              </div>
            </div>
            <div className="onboarding-section">
              <div className="onboarding-section__heading"><strong>Contacto</strong><span>Cómo pueden encontrar tu gimnasio</span></div>
              <div className="onboarding-fields">
              <label className="onboarding-field">
                <span>Número de celular</span>
                <span className="input-with-icon"><Phone size={15} /><input name="contactPhone" value={form.contactPhone} onChange={change} placeholder="351 555 0000" type="tel" required /></span>
              </label>
              <label className="onboarding-field">
                <span>Email de contacto <small>Opcional</small></span>
                <input name="contactEmail" value={form.contactEmail} onChange={change} placeholder="contacto@tugym.com" type="email" />
              </label>
              <label className="onboarding-field onboarding-field--full">
                <span>Ubicación <small>Opcional</small></span>
                <span className="input-with-icon"><MapPin size={15} /><input name="location" value={form.location} onChange={change} placeholder="Dirección, ciudad o provincia" /></span>
              </label>
              </div>
            </div>
            {error && <div className="onboarding-error" role="alert">{error}</div>}
            <button className="onboarding-submit" type="submit" disabled={loading} style={{ '--gym-color': form.primaryColor }}>
              <span>{loading ? 'Guardando...' : 'Finalizar configuración'}</span>{!loading && <Check size={17} />}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
};

export default Onboarding;

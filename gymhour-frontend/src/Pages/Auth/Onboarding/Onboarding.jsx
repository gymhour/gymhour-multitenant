import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ImagePlus, Phone } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../../../axiosConfig';
import CLIENT_SETUP from '../../../setup';
import { useAuth } from '../../../context/AuthContext';
import './onboarding.css';

const INITIAL_FORM = {
  contactPhone: '', name: '',
  primaryColor: '#DA4632', paymentAccountHolder: '', paymentAlias: '', paymentCbu: '',
  paymentTaxId: '', paymentWhatsapp: '',
};

const splitFullName = value => {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] || '' };
};

const Onboarding = () => {
  const navigate = useNavigate();
  const fileInput = useRef(null);
  const { refresh } = useAuth();
  const [step, setStep] = useState(2);
  const [form, setForm] = useState(INITIAL_FORM);
  const [fullName, setFullName] = useState('');
  const [logo, setLogo] = useState(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { firstName, lastName } = splitFullName(fullName);
  const contactStepComplete = firstName.length >= 2
    && lastName.length >= 2
    && form.contactPhone.trim().length >= 6
    && form.name.trim().length >= 3;
  const gymStepComplete = Boolean(logo)
    && Boolean(form.paymentAccountHolder.trim())
    && Boolean(form.paymentAlias.trim());

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

  const continueToGym = event => {
    event.preventDefault();
    setError('');
    if (form.name.trim().length < 3) { setError('Ingresá el nombre de tu gimnasio.'); return; }
    if (firstName.length < 2 || lastName.length < 2) {
      setError('Ingresá tu nombre y apellido.'); return;
    }
    if (form.contactPhone.trim().length < 6) { setError('Ingresá un número de celular válido.'); return; }
    setStep(3);
  };

  const backToContact = event => {
    event.preventDefault();
    setError('');
    setStep(2);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  };

  const submit = async event => {
    event.preventDefault(); setError('');
    if (!logo) { setError('Subí el logo de tu gimnasio.'); return; }
    if (!form.paymentAccountHolder.trim()) { setError('Ingresá el titular de la cuenta.'); return; }
    if (!form.paymentAlias.trim()) { setError('Ingresá el alias para recibir transferencias.'); return; }
    setLoading(true);
    try {
      const body = new FormData();
      Object.entries(form).forEach(([key, value]) => body.append(key, value));
      body.append('firstName', firstName);
      body.append('lastName', lastName);
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
      <div className="onboarding-layout">
        <section className="onboarding-card">
          <img className="onboarding-brand" src={CLIENT_SETUP.branding.logoLight} alt={CLIENT_SETUP.branding.logoAlt} />
          <div className="onboarding-progress">
            <span>Paso {step - 1} de 2</span>
            <div className="onboarding-progress__track" role="progressbar" aria-label="Progreso de configuración" aria-valuemin="0" aria-valuemax="2" aria-valuenow={step - 1}>
              <span style={{ width: step === 2 ? '50%' : '100%' }} />
            </div>
          </div>
          {step === 2 ? (
            <>
              <div className="onboarding-card__title">
                <div><h1>Completá tu perfil</h1></div>
              </div>
              <form onSubmit={continueToGym}>
                <div className="onboarding-section">
                  <div className="onboarding-fields onboarding-fields--simple">
                    <label className="onboarding-field"><span>Nombre del gimnasio</span><input name="name" value={form.name} onChange={change} placeholder="Ej. Distrito Fitness" minLength="3" required /></label>
                    <label className="onboarding-field"><span>Nombre y apellido</span><input name="fullName" value={fullName} onChange={event => setFullName(event.target.value)} placeholder="Tu nombre y apellido" autoComplete="name" required /></label>
                    <label className="onboarding-field"><span>Número de celular</span><span className="input-with-icon"><Phone size={15} /><input name="contactPhone" value={form.contactPhone} onChange={change} placeholder="+54 9 351 000 0000" type="tel" autoComplete="tel" minLength="6" required /></span><span className="onboarding-field__hint">Lo usaremos para validar tu identidad por seguridad.</span></label>
                  </div>
                </div>
                {error && <div className="onboarding-error" role="alert">{error}</div>}
                <div className="onboarding-actions onboarding-actions--end">
                  <button className="onboarding-submit" type="submit" disabled={!contactStepComplete}><span>Continuar</span><ArrowRight size={17} /></button>
                </div>
              </form>
            </>
          ) : (
            <>
              <div className="onboarding-card__title">
                <div><h1>Configurá tu gimnasio</h1><small>Agregá su identidad y los datos para recibir pagos.</small></div>
              </div>
              <form onSubmit={submit}>
                <div className="onboarding-section">
                  <div className="onboarding-section__heading"><strong>Identidad visual</strong></div>
                  <label className="logo-row" htmlFor="onboarding-logo">
                    <span className="logo-picker">
                      {preview ? <img src={preview} alt="Vista previa del logo" /> : <ImagePlus size={23} />}
                    </span>
                    <div className="logo-row__copy"><strong>{preview ? 'Logo seleccionado' : 'Logo del gimnasio'}</strong><span>PNG, JPG o WebP · Máximo 5 MB</span></div>
                    <span className="logo-row__action">{preview ? 'Cambiar' : 'Elegir archivo'}</span>
                  </label>
                  <input id="onboarding-logo" ref={fileInput} className="onboarding-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={selectLogo} hidden />
                  <label className="color-field"><span>Color principal</span><span className="color-control"><input type="color" name="primaryColor" value={form.primaryColor} onChange={change} aria-label="Elegir color principal" /><b>{form.primaryColor}</b><em>Cambiar</em></span></label>
                </div>
                <div className="onboarding-section">
                  <div className="onboarding-section__heading"><strong>Datos para transferencias</strong><span>Para que tus alumnos puedan transferirte sus cuotas.</span></div>
                  <div className="onboarding-fields">
                    <label className="onboarding-field onboarding-field--full"><span>Titular de la cuenta <sup className="onboarding-required" aria-label="obligatorio">*</sup></span><input name="paymentAccountHolder" value={form.paymentAccountHolder} onChange={change} placeholder="Nombre y apellido o razón social" required /></label>
                    <label className="onboarding-field"><span>Alias <sup className="onboarding-required" aria-label="obligatorio">*</sup></span><input name="paymentAlias" value={form.paymentAlias} onChange={change} placeholder="mi.gimnasio" required /></label>
                    <label className="onboarding-field"><span>WhatsApp para comprobantes <small>Opcional</small></span><input name="paymentWhatsapp" value={form.paymentWhatsapp} onChange={change} placeholder="5493510000000" type="tel" /></label>
                    <label className="onboarding-field"><span>CBU o CVU <small>Opcional</small></span><input name="paymentCbu" value={form.paymentCbu} onChange={change} placeholder="22 dígitos" inputMode="numeric" /></label>
                    <label className="onboarding-field"><span>CUIL o CUIT <small>Opcional</small></span><input name="paymentTaxId" value={form.paymentTaxId} onChange={change} placeholder="20-12345678-9" /></label>
                  </div>
                </div>
                {error && <div className="onboarding-error" role="alert">{error}</div>}
                <div className="onboarding-actions">
                  <button className="onboarding-back" type="button" onClick={backToContact}><ArrowLeft size={16} />Atrás</button>
                  <button className="onboarding-submit" type="submit" disabled={loading || !gymStepComplete}><span>{loading ? 'Guardando...' : 'Finalizar configuración'}</span>{!loading && <Check size={17} />}</button>
                </div>
              </form>
            </>
          )}
        </section>
      </div>
    </main>
  );
};

export default Onboarding;

import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CreditCard, ImagePlus, MapPin, Phone } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../../../axiosConfig';
import CLIENT_SETUP from '../../../setup';
import { useAuth } from '../../../context/AuthContext';
import './onboarding.css';

const INITIAL_FORM = {
  firstName: '', lastName: '', contactPhone: '', location: '', contactEmail: '', name: '',
  primaryColor: '#DA4632', paymentAccountHolder: '', paymentAlias: '', paymentCbu: '',
  paymentTaxId: '', paymentWhatsapp: '',
};

const Onboarding = () => {
  const navigate = useNavigate();
  const fileInput = useRef(null);
  const { refresh } = useAuth();
  const [step, setStep] = useState(2);
  const [form, setForm] = useState(INITIAL_FORM);
  const [logo, setLogo] = useState(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const contactStepComplete = form.firstName.trim().length >= 2
    && form.lastName.trim().length >= 2
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
    if (form.firstName.trim().length < 2 || form.lastName.trim().length < 2) {
      setError('Completá tu nombre y apellido.'); return;
    }
    if (form.name.trim().length < 3) { setError('Ingresá el nombre de tu gimnasio.'); return; }
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
      body.append('logo', logo);
      await apiClient.put('/tenant/onboarding', body);
      await refresh();
      navigate('/admin/inicio', { replace: true });
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'No pudimos guardar la configuración. Intentá nuevamente.');
    } finally { setLoading(false); }
  };

  return (
    <main className="onboarding-page" style={{ '--onboarding-background': `url(${CLIENT_SETUP.branding.loginBackground})` }}>
      <div className="onboarding-layout">
        <section className="onboarding-intro">
          <img src={CLIENT_SETUP.branding.logo} alt={CLIENT_SETUP.branding.logoAlt} />
          <div className="onboarding-steps" aria-label="Progreso de configuración">
            <div className="is-complete"><span>01</span><strong>Cuenta</strong><Check className="onboarding-step__desktop-check" size={14} /><span className="onboarding-step__mobile-state"><Check size={12} /></span></div>
            <div className={step === 2 ? 'is-active' : 'is-complete'}><span>02</span><strong>Contacto</strong>{step > 2 && <Check className="onboarding-step__desktop-check" size={14} />}<span className="onboarding-step__mobile-state"><Check size={12} /></span></div>
            <div className={step === 3 ? 'is-active' : ''}><span>03</span><strong>Gimnasio</strong><span className="onboarding-step__mobile-state"><Check size={12} /></span></div>
          </div>
          <p>Podés editar toda esta información después desde Configuración.</p>
        </section>

        <section className="onboarding-card">
          {step === 2 ? (
            <>
              <div className="onboarding-card__title">
                <div><span>Datos de contacto</span><small>Contanos quién administra la cuenta y cómo encontrar el gimnasio.</small></div>
              </div>
              <form onSubmit={continueToGym}>
                <div className="onboarding-section">
                  <div className="onboarding-fields">
                    <label className="onboarding-field"><span>Nombre</span><input name="firstName" value={form.firstName} onChange={change} placeholder="Lucía" minLength="2" required /></label>
                    <label className="onboarding-field"><span>Apellido</span><input name="lastName" value={form.lastName} onChange={change} placeholder="Fernández" minLength="2" required /></label>
                    <label className="onboarding-field"><span>Número de celular</span><span className="input-with-icon"><Phone size={15} /><input name="contactPhone" value={form.contactPhone} onChange={change} placeholder="+54 9 351 000 0000" type="tel" minLength="6" required /></span></label>
                    <label className="onboarding-field"><span>Mail secundario <small>Opcional</small></span><input name="contactEmail" value={form.contactEmail} onChange={change} placeholder="contacto@tugym.com" type="email" /></label>
                  </div>
                </div>
                <div className="onboarding-section">
                  <div className="onboarding-section__heading"><strong>Tu gimnasio</strong><span>Información principal</span></div>
                  <div className="onboarding-fields">
                    <label className="onboarding-field onboarding-field--full"><span>Nombre del gimnasio</span><input name="name" value={form.name} onChange={change} placeholder="Ej. Distrito Fitness" minLength="3" required /></label>
                    <label className="onboarding-field onboarding-field--full"><span>Ubicación <small>Opcional</small></span><span className="input-with-icon"><MapPin size={15} /><input name="location" value={form.location} onChange={change} placeholder="Dirección, ciudad o provincia" /></span></label>
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
                <div><span>Configurá tu gimnasio</span><small>Definí su identidad y cómo recibir pagos de tus alumnos.</small></div>
              </div>
              <form onSubmit={submit}>
                <div className="onboarding-section">
                  <div className="onboarding-section__heading"><strong>Identidad visual</strong><span>Visible para tus socios</span></div>
                  <label className="logo-row" htmlFor="onboarding-logo">
                    <span className="logo-picker">
                      {preview ? <img src={preview} alt="Vista previa del logo" /> : <ImagePlus size={23} />}
                    </span>
                    <div className="logo-row__copy"><strong>{preview ? 'Logo seleccionado' : 'Logo del gimnasio'}</strong><span>PNG, JPG o WebP · Máximo 5 MB</span></div>
                    <span className="logo-row__action">{preview ? 'Cambiar' : 'Elegir archivo'}</span>
                  </label>
                  <input id="onboarding-logo" ref={fileInput} className="onboarding-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={selectLogo} hidden />
                  <label className="color-field"><span>Color principal</span><span className="color-control"><input type="color" name="primaryColor" value={form.primaryColor} onChange={change} aria-label="Elegir color principal" /><b>{form.primaryColor.toUpperCase()}</b><em>Cambiar</em></span></label>
                </div>
                <div className="onboarding-section">
                  <div className="onboarding-section__heading"><strong>Datos de pago</strong><span>Para transferencias</span></div>
                  <div className="payment-note"><CreditCard size={18} /><p><strong>¿Para qué usamos estos datos?</strong><span>Se los mostraremos a tus alumnos para que sepan dónde transferir y, si agregás un WhatsApp, dónde enviar el comprobante.</span></p></div>
                  <div className="onboarding-fields">
                    <label className="onboarding-field onboarding-field--full"><span>Titular de la cuenta <sup className="onboarding-required" aria-label="obligatorio">*</sup></span><input name="paymentAccountHolder" value={form.paymentAccountHolder} onChange={change} placeholder="Nombre y apellido o razón social" required /></label>
                    <label className="onboarding-field"><span>Alias <sup className="onboarding-required" aria-label="obligatorio">*</sup></span><input name="paymentAlias" value={form.paymentAlias} onChange={change} placeholder="MI.GIMNASIO" required /></label>
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

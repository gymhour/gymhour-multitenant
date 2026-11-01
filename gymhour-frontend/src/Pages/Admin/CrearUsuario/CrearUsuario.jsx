import React, { useState, useEffect, useMemo } from 'react';
import SidebarMenu from '../../../Components/SidebarMenu/SidebarMenu';
import CustomDropdown from '../../../Components/utils/CustomDropdown/CustomDropdown';
import apiClient from '../../../axiosConfig';
import apiService from '../../../services/apiService';
import { toast } from 'react-toastify';
import { ROLE_OPTIONS } from '../../../utils/roleLabels';
import { feeDurationLabel } from '../../../utils/feeDuration';
import LoaderFullScreen from '../../../Components/utils/LoaderFullScreen/LoaderFullScreen';
import { useNavigate } from 'react-router-dom';
import CustomInput from '../../../Components/utils/CustomInput/CustomInput';
import '../UsuarioForm.css';
import './CrearUsuarioCuota.css';
import SecondaryButton from '../../../Components/utils/SecondaryButton/SecondaryButton';
import ConfirmationPopup from '../../../Components/utils/ConfirmationPopUp/ConfirmationPopUp';
import { ArrowLeft, ChevronDown } from 'lucide-react';

const DAY_ORDER = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, miércoles: 3,
  jueves: 4, viernes: 5, sabado: 6, sábado: 6,
};

const formatHora = (iso) => (iso || '').slice(11, 16);
const formatDay = (day) => day ? new Date(`${day}T00:00:00Z`).toLocaleDateString('es-AR', { timeZone: 'UTC' }) : '';

const sortHorarios = (horarios) =>
  [...horarios].sort((a, b) => {
    const dayA = DAY_ORDER[String(a.diaSemana).trim().toLowerCase()] ?? 99;
    const dayB = DAY_ORDER[String(b.diaSemana).trim().toLowerCase()] ?? 99;
    if (dayA !== dayB) return dayA - dayB;
    return formatHora(a.horaIni).localeCompare(formatHora(b.horaIni));
  });

// Motivos de alta (debe coincidir con MOTIVOS_ALTA del backend en user.Controller.ts)
const MOTIVOS_ALTA = [
  'Buenas instalaciones',
  'Precio competitivo / promoción',
  'Buena atención',
  'Cercanía / ubicación',
  'Recomendación de un conocido',
  'Redes sociales / publicidad',
  'Variedad de clases y horarios',
  'Calidad de los entrenadores',
  'Recomendación médica / salud',
  'Otro / Sin motivo',
];

const CrearUsuario = ({fromAdmin, fromTRAINER}) => {
  const initialFormData = {
    email: '',
    password: '',
    dni: '',
    nombre: '',
    apellido: '',
    profesion: '',
    direc: '',
    tel: '',
    role: 'STUDENT',
    fechaCumple: '',
    plan: '',
    motivoAlta: '',
    usaTurnosFijos: false,
    observacionesSalud: '',
    fichaMedicaUrl: '',
  };

  const [formData, setFormData] = useState(initialFormData);
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSendingWelcomeEmail, setIsSendingWelcomeEmail] = useState(false);
  const [createdUser, setCreatedUser] = useState(null);
  const [askFirstFee, setAskFirstFee] = useState(false);
  const [firstFeePreview, setFirstFeePreview] = useState(null);
  const [firstFeePreviewError, setFirstFeePreviewError] = useState('');
  const [firstFeeStart, setFirstFeeStart] = useState(new Date().toLocaleDateString('sv-SE'));
  const [firstFeeBusy, setFirstFeeBusy] = useState(false);
  const [firstFeeForm, setFirstFeeForm] = useState({ fechaFin: '', vence: '', importe: '', pagada: false, formaPago: 'Efectivo', fechaPago: new Date().toLocaleDateString('sv-SE') });
  const [planOptions, setPlanOptions] = useState([]);
  const [clases, setClases] = useState([]);
  const [turnosFijos, setTurnosFijos] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchPlanes = async () => {
      try {
        const data = await apiService.getPlanes();
        setPlanOptions(data.map(p => ({ label: p.nombre, value: p.ID_Plan, sesionesPorSemana: p.sesionesPorSemana || 0 })));
      } catch (error) {
        console.error('Error al cargar planes:', error);
        toast.error(error?.message || 'No se pudieron cargar los planes disponibles');
      }
    };
    fetchPlanes();
    const fetchClases = async () => {
      try {
        const data = await apiService.getClases();
        setClases(data || []);
      } catch (error) {
        console.error('Error al cargar clases:', error);
      }
    };
    fetchClases();
  }, []);

  const clasesWithAvailable = useMemo(() =>
    clases.filter(c =>
      (c.HorariosClase || []).some(h =>
        h.activo !== false && (h.cupos - (h.turnosFijosCount || 0)) > 0
      )
    ),
    [clases]
  );

  const getClaseForHorario = (horarioId) =>
    clases.find(c => c.HorariosClase?.some(h => h.ID_HorarioClase === horarioId)) || null;

  const getDiaForHorario = (horarioId) => {
    for (const c of clases) {
      const h = (c.HorariosClase || []).find(h => h.ID_HorarioClase === horarioId);
      if (h) return String(h.diaSemana || '').trim().toLowerCase();
    }
    return null;
  };

  const getHorariosForClase = (claseId) => {
    const clase = clases.find(c => c.ID_Clase === claseId);
    if (!clase) return [];
    return sortHorarios(
      (clase.HorariosClase || []).filter(h =>
        h.activo !== false && (h.cupos - (h.turnosFijosCount || 0)) > 0
      )
    );
  };

  const getFirstHorarioForClase = (claseId) => getHorariosForClase(claseId)[0] || null;

  const addTurnoFijo = () => {
    if (turnosFijos.length >= 7) {
      toast.warning('Máximo un turno fijo por día (hasta 7).');
      return;
    }
    const firstClase = clasesWithAvailable[0];
    if (!firstClase) {
      toast.warning('No hay clases con horarios disponibles.');
      return;
    }
    const firstHorario = getFirstHorarioForClase(firstClase.ID_Clase);
    setTurnosFijos(prev => [...prev, {
      horarioId: firstHorario?.ID_HorarioClase || null,
      editing: true,
    }]);
  };

  const updateHorario = (index, horarioId) => {
    setTurnosFijos(prev => prev.map((item, idx) =>
      idx === index ? { ...item, horarioId } : item
    ));
  };

  const updateClase = (index, claseId) => {
    const firstHorario = getFirstHorarioForClase(claseId);
    setTurnosFijos(prev => prev.map((item, idx) =>
      idx === index ? { ...item, horarioId: firstHorario?.ID_HorarioClase || null } : item
    ));
  };

  const removeTurnoFijo = (index) => {
    setTurnosFijos(prev => prev.filter((_, idx) => idx !== index));
  };

  const confirmTurnoFijo = (index) => {
    const current = turnosFijos[index];
    const dia = current?.horarioId ? getDiaForHorario(current.horarioId) : null;
    if (dia && turnosFijos.some((t, i) => i !== index && t.horarioId && getDiaForHorario(t.horarioId) === dia)) {
      toast.warning('Ya tenés un turno fijo ese día. No se permiten dos turnos fijos el mismo día.');
      return;
    }
    setTurnosFijos(prev => prev.map((item, idx) =>
      idx === index ? { ...item, editing: false } : item
    ));
  };

  const editTurnoFijo = (index) => {
    setTurnosFijos(prev => prev.map((item, idx) =>
      idx === index ? { ...item, editing: true } : item
    ));
  };

  const handleChange = (eOrVal) => {
    const { name, value, type, checked } = eOrVal.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setAvatarFile(file);
      setAvatarPreview(URL.createObjectURL(file));
    } else {
      setAvatarFile(null);
      setAvatarPreview("");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();            // ← evita el submit nativo
    if (isLoading) return;

    // Validación de email tolerante a acentos/Unicode (el type="email" nativo rechaza no-ASCII).
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test((formData.email || '').trim())) {
      toast.error('Ingresá un email válido');
      return;
    }

    try {
      setIsLoading(true);

      // Normalizo la fecha (si tu API espera "YYYY-MM-DD", enviá esa forma)
      const fechaPlano = formData.fechaCumple || '';
      const isoFecha = fechaPlano ? new Date(fechaPlano).toISOString() : '';

      // Valido plan si es STUDENT
      let idPlan = null;
      if (formData.role === 'STUDENT') {
        const selectedPlan = planOptions.find(p => p.label === formData.plan);
        if (!selectedPlan) {
          toast.error('Seleccioná un plan');
          setIsLoading(false);
          return;
        }
        idPlan = selectedPlan.value;
      }

      const payload = new FormData();
      payload.append('email', formData.email.trim());
      payload.append('password', formData.password);
      payload.append('dni', formData.dni.trim());
      payload.append('nombre', formData.nombre.trim());
      payload.append('apellido', formData.apellido.trim());
      payload.append('direc', formData.direc.trim());
      payload.append('tel', formData.tel.trim());
      payload.append('role', formData.role ? formData.role.toLowerCase() : '');
      payload.append('fechaCumple', isoFecha);
      payload.append('observacionesSalud', formData.observacionesSalud.trim());
      payload.append('fichaMedicaUrl', formData.fichaMedicaUrl.trim());
      if (formData.motivoAlta) payload.append('motivoAlta', formData.motivoAlta);

      if (idPlan) payload.append('ID_Plan', idPlan);
      payload.append('usaTurnosFijos', String(formData.usaTurnosFijos));
      if (formData.usaTurnosFijos) {
        const uniqueTurnos = turnosFijos.map(t => t.horarioId).filter(Boolean);
        if (uniqueTurnos.length === 0) {
          toast.error('Seleccioná al menos un turno fijo');
          setIsLoading(false);
          return;
        }
        payload.append('turnosFijos', JSON.stringify(uniqueTurnos));
      }
      if (formData.role === 'TRAINER' && formData.profesion) {
        payload.append('profesion', formData.profesion.trim());
      }
      if (avatarFile) {
        payload.append('avatar', avatarFile);
      }

      const { data: newUser } = await apiClient.post('/usuarios', payload, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      toast.success('Usuario añadido correctamente');
      setFormData(initialFormData);
      setTurnosFijos([]);
      setAvatarFile(null);
      setAvatarPreview("");
      setCreatedUser({
        id: newUser.ID_Usuario,
        email: newUser.email,
        nombre: [newUser.nombre, newUser.apellido].filter(Boolean).join(' '),
      });
      setFirstFeeStart(new Date().toLocaleDateString('sv-SE'));
      setAskFirstFee(Boolean(fromAdmin && idPlan && formData.role === 'STUDENT'));
    } catch (error) {
      console.error(error);
      const msg = error?.response?.data?.message || 'No se pudo registrar el usuario';
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const finishCreation = () => {
    if (isSendingWelcomeEmail) return;
    setCreatedUser(null);
    navigate("/admin/usuarios");
  };

  const handleSendWelcomeEmail = async () => {
    if (!createdUser?.id || isSendingWelcomeEmail) return;
    try {
      setIsSendingWelcomeEmail(true);
      await apiClient.post(`/usuarios/${createdUser.id}/welcome-email`);
      toast.success(`Mail de bienvenida enviado a ${createdUser.email}`);
      setCreatedUser(null);
      navigate("/admin/usuarios");
    } catch (error) {
      console.error(error);
      const msg = error?.response?.data?.message || 'No pudimos enviar el mail de bienvenida. Podés volver a intentarlo.';
      toast.error(msg);
    } finally {
      setIsSendingWelcomeEmail(false);
    }
  };

  const tipos = fromAdmin ? ROLE_OPTIONS : ROLE_OPTIONS.filter(({ value }) => value === 'STUDENT');

  useEffect(() => {
    if (!askFirstFee || !createdUser?.id || !firstFeeStart) return;
    let active = true;
    setFirstFeePreview(null);
    setFirstFeePreviewError('');
    apiClient.get(`/cuotas/usuario/${createdUser.id}/preview`, { params: { fechaInicioCobro: firstFeeStart } }).then(({ data }) => {
      if (!active) return;
      setFirstFeePreview(data);
      setFirstFeeForm(form => ({ ...form, fechaFin: data.fechaFinSugerida, vence: data.vence, importe: String(data.importeSugerido) }));
    }).catch(error => {
      if (active) setFirstFeePreviewError(error?.response?.data?.message || 'No se pudo preparar la primera cuota.');
    });
    return () => { active = false; };
  }, [askFirstFee, createdUser?.id, firstFeeStart]);

  const saveFirstFee = async event => {
    event.preventDefault();
    if (!createdUser?.id) return;
    setFirstFeeBusy(true);
    try {
      await apiClient.post(`/cuotas/usuario/${createdUser.id}`, {
        fechaInicioCobro: firstFeeStart,
        fechaFin: firstFeeForm.fechaFin,
        vence: firstFeeForm.vence,
        importe: Number(firstFeeForm.importe),
        pagada: firstFeeForm.pagada,
        ...(firstFeeForm.pagada ? { formaPago: firstFeeForm.formaPago, fechaPago: firstFeeForm.fechaPago } : {}),
      });
      toast.success('Primera cuota creada.');
      setAskFirstFee(false);
    } catch (error) { toast.error(error?.response?.data?.message || 'No se pudo crear la primera cuota.'); }
    finally { setFirstFeeBusy(false); }
  };

  return (
    <div className="page-layout">
      {isLoading && <LoaderFullScreen />}
      <SidebarMenu isAdmin={fromAdmin} isTRAINER={fromTRAINER} />
      <ConfirmationPopup
        isOpen={Boolean(createdUser) && !askFirstFee}
        onClose={finishCreation}
        onConfirm={handleSendWelcomeEmail}
        message={`El usuario ya fue creado. ¿Querés enviarle ahora el mail de bienvenida a ${createdUser?.nombre ? `${createdUser.nombre} (${createdUser.email})` : createdUser?.email || 'este usuario'}?`}
        cancelText="No enviar"
        confirmText="Sí, enviar"
        isLoading={isSendingWelcomeEmail}
      />
      {createdUser && askFirstFee && <div className="first-fee-overlay">
        <form className="first-fee-dialog" role="dialog" aria-modal="true" aria-labelledby="first-fee-title" onSubmit={saveFirstFee}>
          <h3 id="first-fee-title">¿Crear la primera cuota?</h3>
          <p>{createdUser.nombre || createdUser.email} ya tiene su cuenta. Elegí cuándo comienza su cobro y cómo registrar la primera cuota. Si la omitís, el cobro automático quedará pausado.</p>
          <label>Inicio del período<input type="date" min={new Date().toLocaleDateString('sv-SE')} required value={firstFeeStart} onChange={e => setFirstFeeStart(e.target.value)} /></label>
          {firstFeePreviewError ? <p className="first-fee-error" role="alert">{firstFeePreviewError}</p> : !firstFeePreview ? <p>Calculando período…</p> : <>
            <p className="first-fee-period">El período cubre del {formatDay(firstFeePreview.fechaInicio)} al {formatDay(firstFeePreview.fechaFinSugerida)}. Vencimiento del pago sugerido: {formatDay(firstFeePreview.vence)}.</p>
            <label>Fin del período<input type="date" value={firstFeeForm.fechaFin} disabled aria-describedby="first-fee-end-explanation" /><small id="first-fee-end-explanation">Este plan cubre {feeDurationLabel(firstFeePreview.plan.duracion)}. Por eso, el fin se calcula automáticamente. Para cambiarlo, modificá el plan del socio.</small></label>
            <label>Vencimiento del pago<input type="date" value={firstFeeForm.vence} min={firstFeePreview.fechaInicio} max={firstFeeForm.fechaFin} onChange={e => setFirstFeeForm({ ...firstFeeForm, vence: e.target.value })} required /></label>
            <label>Importe<input type="number" min="0" step="0.01" value={firstFeeForm.importe} onChange={e => setFirstFeeForm({ ...firstFeeForm, importe: e.target.value })} required /></label>
            <label>Estado<select value={firstFeeForm.pagada ? 'pagada' : 'pendiente'} onChange={e => setFirstFeeForm({ ...firstFeeForm, pagada: e.target.value === 'pagada' })}><option value="pendiente">Pendiente</option><option value="pagada">Pagada</option></select></label>
            {firstFeeForm.pagada && <>
              <label>Medio de pago<input value={firstFeeForm.formaPago} onChange={e => setFirstFeeForm({ ...firstFeeForm, formaPago: e.target.value })} required /></label>
              <label>Fecha de pago<input type="date" max={new Date().toLocaleDateString('sv-SE')} value={firstFeeForm.fechaPago} onChange={e => setFirstFeeForm({ ...firstFeeForm, fechaPago: e.target.value })} required /></label>
            </>}
          </>}
          <div className="first-fee-actions"><button type="button" onClick={() => setAskFirstFee(false)}>Ahora no</button><button type="submit" disabled={!firstFeePreview || firstFeeBusy}>{firstFeeBusy ? 'Guardando…' : 'Crear cuota'}</button></div>
        </form>
      </div>}
      <div className="content-layout">
        <div className="usuario-form-page">
          <SecondaryButton
            text="Volver atrás"
            linkTo="/admin/usuarios"
            icon={ArrowLeft}
            reversed={true}
          />
          <div className="usuario-create-heading">
            <h2>Crear usuario</h2>
            <p>Completá los datos de acceso y configurá el perfil. Los datos opcionales pueden agregarse más adelante.</p>
          </div>

          <form className="usuario-form usuario-create-form" onSubmit={handleSubmit}>
            <section className="usuario-create-section" aria-labelledby="create-essential-title">
              <div className="usuario-create-section-heading"><h3 id="create-essential-title">Datos de acceso</h3><p>Estos datos identifican a la persona y le permiten ingresar a la app.</p></div>
              <div className="usuario-create-grid">
                <div className="usuario-form-field usuario-form-field--full">
                  <label htmlFor="role">Tipo de usuario</label>
                  <CustomDropdown options={tipos} value={formData.role} onChange={event => {
                    const role = event.target.value;
                    setFormData(current => ({ ...current, role, ...(role !== 'STUDENT' ? { plan: '', motivoAlta: '', usaTurnosFijos: false } : {}) }));
                    if (role !== 'STUDENT') setTurnosFijos([]);
                  }} name="role" id="role" placeholderOption={null} />
                </div>
                <div className="usuario-form-field usuario-form-field--full">
                  <label htmlFor="email">Email <span className="usuario-required">*</span></label>
                  <CustomInput type="text" id="email" name="email" value={formData.email} onChange={handleChange} required placeholder="nombre@ejemplo.com" width="100%" autoComplete="email" />
                </div>
                <div className="usuario-form-field">
                  <label htmlFor="nombre">Nombre <span className="usuario-required">*</span></label>
                  <CustomInput type="text" id="nombre" name="nombre" value={formData.nombre} onChange={handleChange} required placeholder="Nombre" width="100%" autoComplete="given-name" />
                </div>
                <div className="usuario-form-field">
                  <label htmlFor="apellido">Apellido <span className="usuario-required">*</span></label>
                  <CustomInput type="text" id="apellido" name="apellido" value={formData.apellido} onChange={handleChange} required placeholder="Apellido" width="100%" autoComplete="family-name" />
                </div>
                <div className="usuario-form-field usuario-form-field--full">
                  <label htmlFor="password">Contraseña <span className="usuario-required">*</span></label>
                  <CustomInput type="password" id="password" name="password" value={formData.password} onChange={handleChange} required placeholder="Elegí una contraseña" width="100%" autoComplete="new-password" />
                </div>
              </div>
            </section>

          {formData.role === 'STUDENT' && (
            <section className="usuario-create-section" aria-labelledby="create-app-title">
              <div className="usuario-create-section-heading"><h3 id="create-app-title">Plan y gestión</h3><p>Asigná el plan y, si corresponde, los turnos fijos. La fecha de inicio de cobro se elige al crear la primera cuota.</p></div>
              <div className="usuario-create-grid">
              <div className="usuario-form-field">
              <label htmlFor="plan">Plan <span className="usuario-required">*</span></label>
              <CustomDropdown
                options={planOptions.map(p => p.label)}
                value={formData.plan}
                onChange={(e) => {
                  const label = e?.target?.value ?? '';
                  setFormData(f => ({ ...f, plan: label }));
                }}
                name="plan" id="plan"
              />

              </div>
              <div className="usuario-form-field">
              <label htmlFor="motivoAlta">Motivo de alta</label>
              <CustomDropdown
                options={MOTIVOS_ALTA}
                value={formData.motivoAlta}
                onChange={handleChange}
                name="motivoAlta" id="motivoAlta"
                placeholderOption="— Seleccioná un motivo —"
                placeholderDisabled={false}
              />
              </div>

              <div className="usuario-form-field usuario-form-field--full"><label className="usuario-form-toggle">
                  <span className="toggle-switch">
                    <input
                      type="checkbox"
                      name="usaTurnosFijos"
                      checked={formData.usaTurnosFijos}
                      onChange={handleChange}
                    />
                    <span className="toggle-slider"></span>
                  </span>
                  Usa turnos fijos
                </label></div>

              {formData.usaTurnosFijos && (
                <div className="usuario-turnos-fijos usuario-form-field--full">
                  {turnosFijos.map((item, index) => {
                    const clase = item.horarioId ? getClaseForHorario(item.horarioId) : null;
                    const horario = item.horarioId
                      ? (() => {
                          for (const c of clases) {
                            const h = c.HorariosClase?.find(h => h.ID_HorarioClase === item.horarioId);
                            if (h) return h;
                          }
                          return null;
                        })()
                      : null;

                    return (
                      <div key={index} className="usuario-turno-fijo-row">
                        {item.editing ? (
                          <>
                            <CustomDropdown
                              options={clasesWithAvailable.map(c => c.nombre)}
                              value={(item.horarioId ? getClaseForHorario(item.horarioId) : null)?.nombre || clasesWithAvailable[0]?.nombre || ''}
                              onChange={(e) => {
                                const val = e?.target?.value ?? '';
                                const c = clasesWithAvailable.find(c => c.nombre === val);
                                if (c) updateClase(index, c.ID_Clase);
                              }}
                              name={`clase-${index}`}
                              id={`clase-${index}`}
                            />
                            <select
                              value={item.horarioId || ''}
                              onChange={(e) => updateHorario(index, Number(e.target.value))}
                              className="turno-fijo-select"
                            >
                              {(() => {
                                const currentClase = getClaseForHorario(item.horarioId);
                                const claseId = currentClase?.ID_Clase || clasesWithAvailable[0]?.ID_Clase;
                                return getHorariosForClase(claseId).map(h => (
                                  <option key={h.ID_HorarioClase} value={h.ID_HorarioClase}>
                                    {h.diaSemana} {formatHora(h.horaIni)} ({h.cupos - (h.turnosFijosCount || 0)} disp.)
                                  </option>
                                ));
                              })()}
                            </select>
                            <button type="button" className="turno-fijo-btn turno-fijo-btn-confirm" onClick={() => confirmTurnoFijo(index)}>Confirmar</button>
                            <button type="button" className="turno-fijo-btn turno-fijo-btn-remove" onClick={() => removeTurnoFijo(index)}>Quitar</button>
                          </>
                        ) : (
                          <>
                            <span className="turno-fijo-preview">
                              {clase?.nombre || '?'} · {horario?.diaSemana || '?'} {formatHora(horario?.horaIni)}
                            </span>
                            <button type="button" className="turno-fijo-btn turno-fijo-btn-edit" onClick={() => editTurnoFijo(index)}>Editar</button>
                            <button type="button" className="turno-fijo-btn turno-fijo-btn-remove" onClick={() => removeTurnoFijo(index)}>Quitar</button>
                          </>
                        )}
                      </div>
                    );
                  })}
                  <button type="button" className="turno-fijo-btn-add" onClick={addTurnoFijo} disabled={clasesWithAvailable.length === 0}>
                    + Agregar turno fijo
                  </button>
                  <span className="usuario-form-help">
                    Máximo un turno fijo por día.
                  </span>
                </div>
              )}
              </div>
            </section>
          )}

            <details className="usuario-create-section usuario-create-section--collapsible">
              <summary className="usuario-create-disclosure"><span className="usuario-create-section-heading"><h3>Datos opcionales</h3><p>Información de contacto y perfil. Podés completarla después.</p></span><ChevronDown size={20} aria-hidden="true" /></summary>
              <div className="usuario-create-grid">
                <div className="usuario-form-field"><label htmlFor="dni">DNI</label><CustomInput type="text" id="dni" name="dni" value={formData.dni} onChange={handleChange} placeholder="Número de documento" width="100%" /></div>
                <div className="usuario-form-field"><label htmlFor="direc">Domicilio</label><CustomInput type="text" id="direc" name="direc" value={formData.direc} onChange={handleChange} placeholder="Calle y número" width="100%" /></div>
                <div className="usuario-form-field"><label htmlFor="tel">Teléfono</label><CustomInput type="tel" id="tel" name="tel" value={formData.tel} onChange={handleChange} placeholder="Número de teléfono" width="100%" autoComplete="tel" /></div>
                <div className="usuario-form-field"><label htmlFor="fechaCumple">Fecha de nacimiento</label><CustomInput type="date" id="fechaCumple" name="fechaCumple" value={formData.fechaCumple} onChange={handleChange} width="100%" max={new Date().toLocaleDateString('sv-SE')} /></div>
                {formData.role === 'TRAINER' && <div className="usuario-form-field"><label htmlFor="profesion">Profesión</label><CustomInput type="text" id="profesion" name="profesion" value={formData.profesion} onChange={handleChange} placeholder="Profesión" width="100%" /></div>}
                <div className="usuario-form-field usuario-form-field--full"><label htmlFor="avatar">Foto</label><input type="file" id="avatar" name="avatar" accept="image/*" onChange={handleFileChange} /></div>
                {avatarPreview && <div className="preview-container usuario-form-preview"><img src={avatarPreview} alt="Vista previa de la foto" className="preview-img" /></div>}
              </div>
            </details>

            <details className="usuario-create-section usuario-create-section--collapsible">
              <summary className="usuario-create-disclosure"><span className="usuario-create-section-heading"><h3>Datos de salud</h3><p>Ficha médica y observaciones para el equipo. Podés completarlas después.</p></span><ChevronDown size={20} aria-hidden="true" /></summary>
              <div className="usuario-create-grid">
                <div className="usuario-form-field usuario-form-field--full"><label htmlFor="fichaMedicaUrl">Ficha médica</label><CustomInput type="url" id="fichaMedicaUrl" name="fichaMedicaUrl" value={formData.fichaMedicaUrl} onChange={handleChange} placeholder="Enlace a la ficha médica" width="100%" /></div>
                <div className="usuario-form-field usuario-form-field--full"><label htmlFor="observacionesSalud">Observaciones</label><textarea id="observacionesSalud" name="observacionesSalud" value={formData.observacionesSalud} onChange={handleChange} placeholder="Lesiones, recomendaciones u otra información importante" rows={4} className="usuario-form-textarea" /></div>
              </div>
            </details>

            <div className="usuario-form-actions">
              <button type="submit" className="primary-button" disabled={isLoading}>
                {isLoading ? "Creando..." : "Crear usuario"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default CrearUsuario;

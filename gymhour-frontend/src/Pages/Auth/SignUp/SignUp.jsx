import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  CalendarDays,
  CreditCard,
  Users,
  BarChart3,
  ArrowRight,
  Check,
} from "lucide-react";
import { authClient } from "../../../axiosConfig";
import { useAuth } from "../../../context/AuthContext";
import CLIENT_SETUP from "../../../setup";
import "./signup.css";

const features = [
  [
    CalendarDays,
    "Clases y turnos",
    "Organizá horarios y dejá que tus alumnos reserven su lugar.",
  ],
  [
    CreditCard,
    "Cuotas bajo control",
    "Seguí pagos y vencimientos desde un solo lugar.",
  ],
  [
    Users,
    "Tu comunidad conectada",
    "Dales a tus alumnos acceso a clases, rutinas y progreso.",
  ],
  [
    BarChart3,
    "Más claridad para decidir",
    "Consultá asistencias y actividad de tu gimnasio.",
  ],
];
const faqs = [
  [
    "¿Cuánto tiempo puedo probar Gymhour?",
    "Podés probar Gymhour gratis durante 14 días. Durante ese tiempo podés conocer las herramientas y configurar tu gimnasio a tu ritmo.",
  ],
  [
    "¿Necesito cargar todos los datos ahora?",
    "No. Primero creás tu cuenta con email y contraseña. Después configurás tu gimnasio paso a paso y completás la información cuando la tengas a mano.",
  ],
  [
    "¿Mis alumnos también pueden usar Gymhour?",
    "Sí. Tus alumnos tienen su propio acceso para consultar clases y rutinas, reservar turnos y seguir su progreso. Así pueden resolver tareas cotidianas sin depender de un mensaje a recepción.",
  ],
  [
    "¿Puedo usarlo desde el celular?",
    "Sí. Gymhour se adapta a celulares, tablets y computadoras. Podés consultar la información de tu gimnasio desde el dispositivo que te resulte más cómodo.",
  ],
  [
    "¿Puedo organizar clases y reservas?",
    "Sí. Podés definir las actividades y sus horarios, y permitir que tus alumnos reserven turnos. Las reservas quedan organizadas en la plataforma para que tengas una visión más clara de cada clase.",
  ],
  [
    "¿Cómo me ayuda con las cuotas?",
    "Podés consultar los pagos y vencimientos de tus alumnos desde un mismo lugar. Eso te permite hacer seguimiento de las cuotas con menos trabajo manual.",
  ],
];

const SignUp = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [form, setForm] = useState({ email: "", password: "" });
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const change = (event) =>
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  const handleSubmit = async (event) => {
    event.preventDefault();
    if (form.password !== confirmPassword) {
      setMessage("Las contraseñas no coinciden.");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const { data } = await authClient.post("/auth/tenants", form);
      await login(data.token);
      if (data.kioskActivationToken)
        sessionStorage.setItem(
          "newKioskActivationToken",
          data.kioskActivationToken,
        );
      navigate("/onboarding", { replace: true });
    } catch (error) {
      setMessage(
        error.response?.data?.message ||
          "No se pudo crear el gimnasio. Intentá de nuevo.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="signup-page">
      <section className="signup-hero">
        <header className="signup-nav signup-container">
          <Link to="/" aria-label="Gymhour, inicio">
            <img src={CLIENT_SETUP.branding.logo} alt="Gymhour" />
          </Link>
          <Link className="signup-nav__login" to="/">
            Ya tengo cuenta <ArrowRight size={16} />
          </Link>
        </header>
        <div className="signup-hero__grid signup-container">
          <div className="signup-story">
            <h1>Hecho para quienes hacen crecer el fitness.</h1>
            <p>
              Gestioná tu gimnasio, simplificá tu día a día y hacé crecer tu
              negocio con todo lo que necesitás en un solo lugar.
            </p>
            {/* <ul className="signup-benefits">
              <li>
                <Check size={17} /> 14 días para probarlo gratis
              </li>
              <li>
                <Check size={17} /> Tu cuenta lista en minutos
              </li>
              <li>
                <Check size={17} /> Accedé desde cualquier dispositivo
              </li>
            </ul> */}
            <div className="signup-stars">
              <span aria-hidden="true">★★★★★</span>
              <small>Por mas de +50 gimnasios en Argentina</small>
            </div>
          </div>
          <div className="signup-card" id="crear-cuenta">
            <span className="signup-section-label">Empezá ahora</span>
            <h2>Creá tu cuenta gratis</h2>
            <p>Probá Gymhour durante 14 días. Solo necesitás tu email.</p>
            <form className="signup-form" onSubmit={handleSubmit}>
              <label>
                Email
                <input
                  name="email"
                  type="email"
                  placeholder="tu@email.com"
                  value={form.email}
                  onChange={change}
                  autoComplete="email"
                  required
                />
              </label>
              <label>
                Contraseña
                <div className="signup-password">
                  <input
                    name="password"
                    type={showPassword ? "text" : "password"}
                    minLength={8}
                    placeholder="Mínimo 8 caracteres"
                    value={form.password}
                    onChange={change}
                    autoComplete="new-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={
                      showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
                    }
                  >
                    {showPassword ? "Ocultar" : "Mostrar"}
                  </button>
                </div>
              </label>
              <label>
                Confirmar contraseña
                <input
                  type={showPassword ? "text" : "password"}
                  minLength={8}
                  placeholder="Repetí tu contraseña"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  required
                />
              </label>
              {message && (
                <div className="signup-error" role="alert">
                  {message}
                </div>
              )}
              <button
                className="signup-submit"
                type="submit"
                disabled={loading}
              >
                {loading ? "Creando tu cuenta..." : "Crear cuenta gratis"}{" "}
                <ArrowRight size={18} />
              </button>
            </form>
            <div className="signup-card__login">
              ¿Ya tenés cuenta? <Link to="/">Iniciá sesión</Link>
            </div>
          </div>
        </div>
      </section>
      <section className="signup-proof signup-container">
        <div>
          <span className="signup-section-label">
            Una comunidad en movimiento
          </span>
          <h2>Más de 50 gimnasios ya eligieron Gymhour.</h2>
        </div>
        <div className="signup-proof__numbers">
          <div>
            <strong>+50</strong>
            <span>gimnasios</span>
          </div>
          <div>
            <strong>+10.000</strong>
            <span>alumnos</span>
          </div>
        </div>
      </section>
      <section className="signup-features">
        <div className="signup-container">
          <span className="signup-section-label">
            Todo tu gimnasio en un lugar
          </span>
          <h2>Lo importante, siempre a mano.</h2>
          <div className="signup-features__grid">
            {features.map(([Icon, title, description]) => (
              <article className="signup-feature" key={title}>
                <div className="signup-feature__icon">
                  <Icon size={24} />
                </div>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="signup-faq signup-container">
        <div>
          <span className="signup-section-label">Preguntas frecuentes</span>
          <h2>Todo claro antes de empezar.</h2>
          <p>
            Una cuenta, unos minutos y ya podés empezar a organizar tu gimnasio.
          </p>
        </div>
        <div>
          {faqs.map(([question, answer]) => (
            <details key={question}>
              <summary>
                {question}
                <span aria-hidden="true">+</span>
              </summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </section>
      <footer className="signup-footer">
        <div className="signup-container">
          <h2>Tu gimnasio puede funcionar mejor desde hoy.</h2>
          <p>Probá Gymhour gratis durante 14 días.</p>
          <a href="#crear-cuenta">
            Crear mi cuenta gratis <ArrowRight size={18} />
          </a>
          <small>© {new Date().getFullYear()} Gymhour</small>
        </div>
      </footer>
    </main>
  );
};
export default SignUp;

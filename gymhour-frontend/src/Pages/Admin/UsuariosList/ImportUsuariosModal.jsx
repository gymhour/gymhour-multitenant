import React, { useState, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import apiClient from '../../../axiosConfig';
import { toast } from 'react-toastify';
import SecondaryButton from '../../../Components/utils/SecondaryButton/SecondaryButton';
import { X, Upload, FileSpreadsheet, AlertCircle, Download } from 'lucide-react';

const COLUMNAS_ESPERADAS = ['email', 'dni', 'nombre', 'apellido', 'tel', 'direc', 'profesion', 'fechaCumple', 'ID_Plan', 'inicioPeriodo', 'cuotaPaga'];

// Normaliza una fecha del Excel a texto DD/MM/AAAA (el backend revalida).
// Cubre: celda fecha real (Date, por cellDates), texto DD/MM/AAAA o ISO, y vacío.
const pad2 = (n) => String(n).padStart(2, '0');
const normalizeFecha = (value) => {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return `${pad2(value.getDate())}/${pad2(value.getMonth() + 1)}/${value.getFullYear()}`;
  }
  return String(value ?? '').trim();
};

// La vista previa muestra el mes en letras: si Excel invirtió día y mes, salta a la vista.
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const fechaLegible = (value) => {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value || '');
  if (!match) return value || '-';
  const [day, month, year] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCDate() !== day || date.getUTCMonth() !== month - 1) return value;
  return `${day} ${MESES[month - 1]} ${year}`;
};

// Columnas de fecha de la plantilla (H: fechaCumple, J: inicioPeriodo) y filas que se preparan como texto.
const COLUMNAS_FECHA = ['H', 'J'];
const FILAS_PLANTILLA = 500;

const ImportUsuariosModal = ({ onClose, onSuccess, planes = [] }) => {
  const fileInputRef = useRef(null);
  const [usuarios, setUsuarios] = useState([]);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState(null);
  const [progress, setProgress] = useState(0);
  const progressTimer = useRef(null);

  // Limpia el intervalo de la barra si el modal se desmonta a mitad de la importación
  useEffect(() => () => { if (progressTimer.current) clearInterval(progressTimer.current); }, []);

  const stopProgress = () => {
    if (progressTimer.current) {
      clearInterval(progressTimer.current);
      progressTimer.current = null;
    }
  };

  const clearFile = () => {
    setUsuarios([]);
    setFileName('');
    setErrors(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setErrors(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        // cellDates: las celdas con formato de fecha vienen como Date (no como número serial)
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        const parsed = json.map((row, i) => ({
          _fila: i + 2,
          email: String(row.email || '').trim(),
          dni: String(row.dni || '').trim(),
          nombre: String(row.nombre || '').trim(),
          apellido: String(row.apellido || '').trim(),
          tel: String(row.tel || '').trim(),
          direc: String(row.direc || '').trim(),
          profesion: String(row.profesion || '').trim(),
          fechaCumple: normalizeFecha(row.fechaCumple),
          ID_Plan: String(row.ID_Plan ?? '').trim(),
          inicioPeriodo: normalizeFecha(row.inicioPeriodo),
          cuotaPaga: String(row.cuotaPaga ?? '').trim(),
        })).filter((u) => COLUMNAS_ESPERADAS.some((columna) => u[columna]));

        setUsuarios(parsed);
        setFileName(file.name);
      } catch {
        toast.error('Error al leer el archivo. Verifique que sea un .xlsx válido.');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleDownloadTemplate = () => {
    const usuariosSheet = XLSX.utils.aoa_to_sheet([COLUMNAS_ESPERADAS]);
    // Las fechas quedan con formato texto para que Excel no las convierta ni invierta día y mes.
    for (let fila = 2; fila <= FILAS_PLANTILLA + 1; fila += 1) {
      COLUMNAS_FECHA.forEach((columna) => { usuariosSheet[`${columna}${fila}`] = { t: 's', v: '', z: '@' }; });
    }
    usuariosSheet['!ref'] = `A1:K${FILAS_PLANTILLA + 1}`;
    const planesSheet = XLSX.utils.aoa_to_sheet([
      ['ID_Plan', 'nombre'],
      ...planes.map((plan) => [plan.ID_Plan, plan.nombre]),
    ]);

    usuariosSheet['!cols'] = [
      { wch: 28 },
      { wch: 14 },
      { wch: 18 },
      { wch: 18 },
      { wch: 16 },
      { wch: 24 },
      { wch: 18 },
      { wch: 14 },
      { wch: 10 },
      { wch: 14 },
      { wch: 10 },
    ];
    planesSheet['!cols'] = [{ wch: 10 }, { wch: 32 }];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, usuariosSheet, 'Usuarios');
    XLSX.utils.book_append_sheet(workbook, planesSheet, 'Planes');
    XLSX.writeFile(workbook, 'plantilla-importacion-usuarios.xlsx');
  };

  const handleImport = async () => {
    if (loading) return;
    if (usuarios.length === 0) {
      toast.error('No hay datos para importar. Verifique que el archivo tenga datos en las columnas correctas.');
      return;
    }

    setLoading(true);
    setErrors(null);

    // Barra de avance estimado: sube sola hasta ~90% (la duración real es desconocida pero acotada);
    // al volver la respuesta saltamos a 100%. No es progreso por usuario (el insert es masivo).
    setProgress(8);
    progressTimer.current = setInterval(() => {
      setProgress(prev => (prev >= 90 ? 90 : prev + Math.max(1, Math.round((90 - prev) / 12))));
    }, 400);

    try {
      const { data } = await apiClient.post('/usuarios/import', { usuarios });
      stopProgress();
      setProgress(100);
      toast.success(data.cuotasCreadas
        ? `${data.count} usuario(s) importado(s) y ${data.cuotasCreadas} cuota(s) creada(s)`
        : `${data.count} usuario(s) importado(s) correctamente`);
      onSuccess();
    } catch (err) {
      stopProgress();
      setProgress(0);
      const errData = err.response?.data;
      if (errData?.errors) {
        setErrors(errData.errors);
        toast.error(err?.message || 'Error en algunos usuarios. Revise los detalles.');
      } else {
        toast.error(errData?.message || 'Error al importar usuarios');
      }
    } finally {
      setLoading(false);
    }
  };

  const getUsuarioByFila = (fila) => usuarios.find((u) => u._fila === fila);

  return (
    <div className="modal-overlay import-users-overlay" onClick={onClose}>
      <div
        className="modal-content import-users-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="import-users-header">
          <div>
            {/* <span className="import-users-eyebrow">Carga masiva</span> */}
            <h3>
              <Upload size={19} />
              Importar usuarios
            </h3>
          </div>
          <button className="import-users-close" onClick={onClose} aria-label="Cerrar modal">
            <X size={20} />
          </button>
        </div>

        <div className="import-users-info">
          <p>Seleccione un archivo .xlsx con estas columnas:</p>
          <code>{COLUMNAS_ESPERADAS.join(', ')}</code>
          <ul>
            <li>Email y DNI son obligatorios.</li>
            <li>La password inicial se crea con el DNI del usuario.</li>
            <li>El tipo de usuario se crea como Cliente.</li>
            <li>ID_Plan debe ser el ID visible en Administración de Planes. Si queda vacío, el usuario se crea sin plan.</li>
            <li>La fecha de cumpleaños debe usar formato dd/mm/yyyy.</li>
            <li>inicioPeriodo es opcional: indicá el inicio del período actual (dd/mm/yyyy) para crear la primera cuota y activar el cobro automático. Si queda vacío, la primera cuota se crea después desde Cuotas.</li>
            <li>cuotaPaga es opcional: SI o NO. Si queda vacío, la cuota se crea impaga.</li>
            <li>Revisá bien las fechas: una cuota impaga cuyo inicio ya pasó queda vencida y bloquea el ingreso y las reservas del socio.</li>
            <li>La plantilla trae las fechas como texto. Si usás tu propio Excel, revisá en la vista previa que el mes sea el correcto.</li>
          </ul>
        </div>

        <div className="import-users-template-row">
          <button
            type="button"
            className="import-users-template-button"
            onClick={handleDownloadTemplate}
            disabled={loading}
          >
            <Download size={18} />
            <span>Descargar plantilla</span>
          </button>
        </div>

        <div className="import-users-upload">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFile}
            className="import-users-file-input"
            hidden
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={`import-users-file-button${fileName ? ' has-file' : ''}`}
            disabled={loading}
          >
            <FileSpreadsheet size={22} />
            <span className="import-users-file-copy">
              <span>{fileName || 'Seleccionar archivo .xlsx'}</span>
              <small>{fileName ? `${usuarios.length} registros detectados` : 'Formato admitido: .xlsx o .xls'}</small>
            </span>
            {fileName && (
              <span
                className="import-users-clear-file"
                onClick={(e) => { e.stopPropagation(); clearFile(); }}
                role="button"
                tabIndex={0}
                aria-label="Quitar archivo"
              >
                <X size={17} />
              </span>
            )}
          </button>
        </div>

        {usuarios.length > 0 && (
          <div className="import-users-preview">
            <div className="import-users-preview-title">
              <span>Vista previa</span>
              <small>{usuarios.length} registros encontrados</small>
            </div>
            <div className="import-users-table-wrap">
              <table className="import-users-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Email</th>
                    <th>DNI</th>
                    <th>Nombre</th>
                    <th>Apellido</th>
                    <th>Cumpleaños</th>
                    <th>ID_Plan</th>
                    <th>Inicio</th>
                    <th>Paga</th>
                  </tr>
                </thead>
                <tbody>
                  {usuarios.slice(0, 50).map((u, i) => (
                    <tr key={i}>
                      <td>{u._fila}</td>
                      <td className={!u.email ? 'is-empty' : ''}>{u.email || 'Vacio'}</td>
                      <td className={!u.dni ? 'is-empty' : ''}>{u.dni || 'Vacio'}</td>
                      <td>{u.nombre || '-'}</td>
                      <td>{u.apellido || '-'}</td>
                      <td>{fechaLegible(u.fechaCumple)}</td>
                      <td>{u.ID_Plan || '-'}</td>
                      <td>{fechaLegible(u.inicioPeriodo)}</td>
                      <td>{u.cuotaPaga || '-'}</td>
                    </tr>
                  ))}
                  {usuarios.length > 50 && (
                    <tr>
                      <td colSpan={9} className="import-users-more-row">
                        Y {usuarios.length - 50} registros mas
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {loading && (
          <div className="import-users-progress">
            <p className="import-users-progress-text">
              Aguarde mientras se realiza la importación masiva de usuarios…
            </p>
            <div className="import-users-progress-track">
              <div className="import-users-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <span className="import-users-progress-pct">{progress}%</span>
          </div>
        )}

        {errors && (
          <div className="import-users-errors">
            <div className="import-users-errors-title">
              <AlertCircle size={17} />
              <span>No se importó ningún usuario</span>
            </div>
            <div className="import-users-errors-table-wrap">
              <table className="import-users-table import-users-errors-table">
                <thead>
                  <tr>
                    <th>Fila</th>
                    <th>Email</th>
                    <th>DNI</th>
                    <th>Nombre</th>
                    <th>Apellido</th>
                    <th>ID_Plan</th>
                    <th>Campo</th>
                    <th>Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {errors.map((e, i) => {
                    const usuario = getUsuarioByFila(e.fila);
                    return (
                      <tr key={`${e.fila}-${e.campo}-${i}`}>
                        <td>{e.fila}</td>
                        <td>{usuario?.email || '-'}</td>
                        <td>{usuario?.dni || '-'}</td>
                        <td>{usuario?.nombre || '-'}</td>
                        <td>{usuario?.apellido || '-'}</td>
                        <td>{usuario?.ID_Plan || '-'}</td>
                        <td>{e.campo}</td>
                        <td>{e.error}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="import-users-actions">
          <SecondaryButton text="Cancelar" onClick={onClose} />
          <button
            onClick={handleImport}
            className="primary-button import-users-submit"
            disabled={usuarios.length === 0 || loading}
          >
            {loading ? 'Importando...' : 'Importar'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImportUsuariosModal;

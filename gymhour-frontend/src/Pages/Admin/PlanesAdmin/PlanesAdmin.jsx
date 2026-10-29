import React, { useState, useEffect } from 'react'
import SidebarMenu from '../../../Components/SidebarMenu/SidebarMenu'
import apiService from '../../../services/apiService'
import './PlanesAdmin.css'
import PrimaryButton from '../../../Components/utils/PrimaryButton/PrimaryButton'
import { ChevronDown, Copy, Edit, Trash2, X } from 'lucide-react'
import CustomInput from '../../../Components/utils/CustomInput/CustomInput'
import LoaderFullScreen from '../../../Components/utils/LoaderFullScreen/LoaderFullScreen'
import ConfirmationPopup from '../../../Components/utils/ConfirmationPopUp/ConfirmationPopUp'
import { toast } from 'react-toastify'
import EmptyState from '../../../Components/utils/EmptyState/EmptyState'
import { useSearchParams } from 'react-router-dom'

const parseDuration = value => {
  const legacy = { SEMANAL: ['WEEKS', 1], MENSUAL: ['MONTHS', 1], BIMESTRAL: ['MONTHS', 2], TRIMESTRAL: ['MONTHS', 3], SEMESTRAL: ['MONTHS', 6], ANUAL: ['MONTHS', 12] }
  const match = /^(WEEKS|MONTHS):(\d+)$/.exec(value || '')
  const [unit, count] = match ? [match[1], Number(match[2])] : (legacy[value] || legacy.MENSUAL)
  return { unit, count }
}

const durationLabel = value => {
  const { unit, count } = parseDuration(value)
  return `${count} ${unit === 'WEEKS' ? (count === 1 ? 'semana' : 'semanas') : (count === 1 ? 'mes' : 'meses')}`
}

const PlanesAdmin = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const [planes, setPlanes] = useState([])
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevoPrecio, setNuevoPrecio] = useState('')
  const [nuevaDesc, setNuevaDesc] = useState('')
  const [duracionUnidad, setDuracionUnidad] = useState('MONTHS')
  const [duracionCantidad, setDuracionCantidad] = useState(1)
  const [sesionesTotales, setSesionesTotales] = useState('')
  const [sesionesGracia, setSesionesGracia] = useState('')
  const [requiereTurno, setRequiereTurno] = useState(true)
  const [toDelete, setToDelete] = useState(null)
  const [editingPlan, setEditingPlan] = useState(null)

  const fetchPlanes = async () => {
    setLoading(true)
    try {
      const data = await apiService.getPlanes()
      setPlanes(data)
    } catch (error) {
      console.error('Error al obtener planes:', error)
      toast.error(error?.message || 'No se pudieron cargar los planes.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPlanes()
  }, [])

  // Abrir modal para crear
  const handleCreate = () => {
    setEditingPlan(null)
    setNuevoNombre('')
    setNuevoPrecio('')
    setNuevaDesc('')
    setDuracionUnidad('MONTHS')
    setDuracionCantidad(1)
    setSesionesTotales('')
    setSesionesGracia('')
    setRequiereTurno(true)
    setShowModal(true)
  }

  useEffect(() => {
    if (searchParams.get('action') !== 'create') return
    handleCreate()
    const next = new URLSearchParams(searchParams)
    next.delete('action')
    setSearchParams(next, { replace: true })
    // El parámetro es una orden de navegación que debe consumirse una sola vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Abrir modal para editar
  const handleEdit = (plan) => {
    setEditingPlan(plan)
    setNuevoNombre(plan.nombre)
    setNuevoPrecio(plan.precio)
    setNuevaDesc(plan.desc || '')
    const duration = parseDuration(plan.duracion)
    setDuracionUnidad(duration.unit)
    setDuracionCantidad(duration.count)
    setSesionesTotales(plan.sesionesTotales ?? '')
    setSesionesGracia(plan.sesionesGracia ?? '')
    setRequiereTurno(plan.requiereTurno !== false)
    setShowModal(true)
  }

  // Cerrar modal y reset
  const handleClose = () => {
    setEditingPlan(null)
    setNuevoNombre('')
    setNuevoPrecio('')
    setNuevaDesc('')
    setDuracionUnidad('MONTHS')
    setDuracionCantidad(1)
    setSesionesTotales('')
    setSesionesGracia('')
    setRequiereTurno(true)
    setShowModal(false)
  }

  // Crear o actualizar plan
  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    const body = {
      nombre: nuevoNombre,
      precio: Number(nuevoPrecio),
      desc: nuevaDesc,
      duracionUnidad,
      duracionCantidad: Number(duracionCantidad),
      sesionesTotales: Number(sesionesTotales || 0),
      sesionesGracia: Number(sesionesGracia || 0),
      requiereTurno
    }
    try {
      if (editingPlan) {
        await apiService.putPlanes(editingPlan.ID_Plan, body)
        toast.success('Plan actualizado correctamente.')
      } else {
        await apiService.postPlanes(body)
        toast.success('Plan creado correctamente.')
      }
      handleClose()
      await fetchPlanes()
    } catch (error) {
      console.error('Error al guardar plan:', error)
      toast.error(error?.message || 'Error al guardar plan. Intente nuevamente.')
    } finally {
      setLoading(false)
    }
  }

  // Abrir popup de confirmación
  const openDeletePopup = (plan) => setToDelete(plan)
  const closeDeletePopup = () => setToDelete(null)

  // Confirmar eliminación
  const confirmDelete = async () => {
    if (!toDelete) return
    setLoading(true)
    try {
      await apiService.deletePlanes(toDelete.ID_Plan)
      toast.success(`Plan "${toDelete.nombre}" eliminado correctamente.`)
      await fetchPlanes()
    } catch (error) {
      console.error('Error al eliminar plan:', error)
      toast.error(error?.message || 'Error al eliminar plan. Intente nuevamente.')
    } finally {
      setLoading(false)
      closeDeletePopup()
    }
  }

  const handleCopyPlanId = async (planId) => {
    try {
      await navigator.clipboard.writeText(String(planId))
      toast.success('ID del plan copiado.')
    } catch (error) {
      console.error('Error al copiar ID del plan:', error)
      toast.error('No se pudo copiar el ID del plan.')
    }
  }

  return (
    <div className="page-layout">
      <SidebarMenu isAdmin={true} />
      {loading && <LoaderFullScreen />}
      <div className="content-layout">
        <div className="planes-header">
          <h2>Administración de Planes</h2>
          <PrimaryButton text='Nuevo plan' onClick={handleCreate} />
        </div>

        {!loading && (
          planes.length === 0 ? (
            <EmptyState
              title="Todavía no hay planes"
              description="Creá el primer plan para definir precios, duración y cantidad de sesiones."
              actionLabel="Crear primer plan"
              onAction={handleCreate}
            />
          ) : (
            <div className="planes-table-wrapper">
              <table className="planes-table">
                <thead>
                  <tr>
                    <th scope="col">ID</th>
                    <th scope="col">Plan</th>
                    <th scope="col">Precio</th>
                    <th scope="col">Duración</th>
                    <th scope="col">Sesiones</th>
                    <th scope="col">Gracia</th>
                    <th scope="col">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {planes.map((plan) => (
                    <tr key={plan.ID_Plan}>
                      <td>
                        <div className="plan-id-wrap">
                          <span className="plan-id">{plan.ID_Plan}</span>
                          <button type="button" className="plan-copy-id" onClick={() => handleCopyPlanId(plan.ID_Plan)} aria-label={`Copiar ID del plan ${plan.nombre}`} title="Copiar ID">
                            <Copy size={14} />
                          </button>
                        </div>
                      </td>
                      <td>
                        <div className="plan-table-name">{plan.nombre}</div>
                        <div className="plan-table-description">{plan.desc || 'Sin descripción'}</div>
                      </td>
                      <td className="plan-table-price">${plan.precio.toLocaleString()}</td>
                      <td>{durationLabel(plan.duracion)}</td>
                      <td>{plan.sesionesTotales || 0}</td>
                      <td>{plan.sesionesGracia || 0}</td>
                      <td>
                        <div className="plan-table-actions">
                          <button type="button" onClick={() => handleEdit(plan)} aria-label={`Editar plan ${plan.nombre}`} title="Editar plan"><Edit size={17} /></button>
                          <button type="button" onClick={() => openDeletePopup(plan)} aria-label={`Eliminar plan ${plan.nombre}`} title="Eliminar plan"><Trash2 size={17} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* Modal de crear/editar */}
        {showModal && (
          <div
            className="plan-modal-overlay"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) handleClose()
            }}
          >
            <div className="plan-modal" role="dialog" aria-modal="true" aria-labelledby="plan-modal-title">
              <form onSubmit={handleSubmit} className="plan-form">
                <div className="plan-modal-header">
                  <div>
                    <h2 id="plan-modal-title">{editingPlan ? 'Editar plan' : 'Nuevo plan'}</h2>
                    <span>{editingPlan ? 'Actualizá los datos del plan seleccionado.' : 'Definí el nombre, precio y condiciones del plan.'}</span>
                  </div>
                  <button type="button" className="plan-modal-close" onClick={handleClose} aria-label="Cerrar modal">
                    <X size={18} />
                  </button>
                </div>

                <div className="plan-form-grid">
                  <div className="plan-form-input-container">
                    <label>Nombre</label>
                    <CustomInput
                      type="text"
                      placeholder="Plan Mensual"
                      value={nuevoNombre}
                      onChange={(e) => setNuevoNombre(e.target.value)}
                      required
                      width="100%"
                    />
                  </div>
                  <div className="plan-form-input-container">
                    <label>Precio</label>
                    <CustomInput
                      type="number"
                      placeholder="50000"
                      value={nuevoPrecio}
                      onChange={(e) => setNuevoPrecio(e.target.value)}
                      required
                      width="100%"
                    />
                  </div>
                  <div className="plan-form-input-container plan-form-field-wide">
                    <label>Descripción</label>
                    <CustomInput
                      placeholder="Plan estándar de los socios mensuales"
                      value={nuevaDesc}
                      onChange={(e) => setNuevaDesc(e.target.value)}
                      width="100%"
                    />
                  </div>
                  <div className="plan-form-input-container">
                    <label htmlFor="duracionCantidad">Duración del ciclo</label>
                    <div className="plan-duration-fields">
                      <input id="duracionCantidad" type="number" min="1" max={duracionUnidad === 'WEEKS' ? '52' : '24'} value={duracionCantidad} onChange={e => setDuracionCantidad(e.target.value)} required />
                      <div className="plan-duration-select">
                        <select value={duracionUnidad} onChange={e => { setDuracionUnidad(e.target.value); setDuracionCantidad(1) }} aria-label="Unidad de duración">
                          <option value="WEEKS">Semanas</option>
                          <option value="MONTHS">Meses</option>
                        </select>
                        <ChevronDown size={18} aria-hidden="true" />
                      </div>
                    </div>
                  </div>
                  <div className="plan-form-input-container">
                    <label>Sesiones totales</label>
                    <CustomInput
                      type="number"
                      min="0"
                      placeholder="30"
                      value={sesionesTotales}
                      onChange={(e) => setSesionesTotales(e.target.value)}
                      width="100%"
                    />
                  </div>
                  <div className="plan-form-input-container">
                    <label>Sesiones de gracia</label>
                    <CustomInput
                      type="number"
                      min="0"
                      placeholder="3"
                      value={sesionesGracia}
                      onChange={(e) => setSesionesGracia(e.target.value)}
                      width="100%"
                    />
                  </div>
                </div>

                <label className="plan-toggle-row">
                  <span className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={requiereTurno}
                      onChange={(e) => setRequiereTurno(e.target.checked)}
                    />
                    <span className="toggle-slider"></span>
                  </span>
                  <span>Requiere turno para asistir</span>
                </label>

                <div className="plan-modal-actions">
                  <button type="button" className="plan-secondary-button" onClick={handleClose}>
                    Cancelar
                  </button>
                  <button type="submit" className="primary-button">
                    {editingPlan ? 'Actualizar' : 'Crear'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Popup de confirmación */}
        {toDelete && (
          <ConfirmationPopup
            isOpen={!!toDelete}
            message={`¿Está seguro que quiere eliminar el plan "${toDelete.nombre}"? Esta acción no se puede deshacer.`}
            onClose={closeDeletePopup}
            onConfirm={confirmDelete}
          />
        )}
      </div>
    </div>
  )
}

export default PlanesAdmin

import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { HOME_BY_ROLE, useAuth } from './context/AuthContext';
import PlanFeatureGate, { featureForPath } from './Components/PlanFeatureGate/PlanFeatureGate';

const ROLES_BY_PREFIX = [
  { prefix: '/admin', roles: ['ADMIN'] },
  { prefix: '/entrenador', roles: ['ADMIN', 'TRAINER'] },
  { prefix: '/alumno', roles: ['ADMIN', 'TRAINER', 'STUDENT'] },
];

const ProtectedRoute = ({ children, roles }) => {
  const location = useLocation();
  const { user, tenant, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/" replace state={{ from: location.pathname }} />;

  const needsOnboarding = user.role === 'ADMIN' && tenant?.settings?.onboardingCompleted === false;
  if (needsOnboarding && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }
  if (!needsOnboarding && location.pathname === '/onboarding') {
    return <Navigate to={HOME_BY_ROLE[user.role] || '/'} replace />;
  }

  const requiredRoles = roles || ROLES_BY_PREFIX.find(entry => location.pathname.startsWith(entry.prefix))?.roles;
  if (requiredRoles?.length && !requiredRoles.includes(user.role)) {
    return <Navigate to={HOME_BY_ROLE[user.role] || '/'} replace />;
  }
  return <PlanFeatureGate feature={featureForPath(location.pathname)} billing={tenant?.billing} role={user.role}>{children}</PlanFeatureGate>;
};

export default ProtectedRoute;

import React from 'react';
import SidebarMenu from '../../../Components/SidebarMenu/SidebarMenu';
import AIHomePanel from '../../../Components/AIHome/AIHomePanel';
import '../../../App.css';
import './AIAssistant.css';

const AIAssistant = ({ role }) => {
  const isAdmin = role === 'ADMIN';
  const isTrainer = role === 'TRAINER';

  return (
    <div className="page-layout ai-assistant-page">
      <SidebarMenu isAdmin={isAdmin} isEntrenador={isTrainer} />
      <main className="content-layout ai-assistant-content">
        <AIHomePanel role={role} />
      </main>
    </div>
  );
};

export default AIAssistant;

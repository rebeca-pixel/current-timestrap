import AppHeader from '../AppHeader';

export default function AppHeaderExample() {
  return (
    <div className="bg-slate-950 min-h-screen">
      <AppHeader 
        user={{
          id: '1',
          employeeCode: 'EMP046',
          name: 'Rebecasuji',
          role: 'admin'
        }}
        onLogout={() => console.log('Logout clicked')}
        onMenuClick={() => console.log('Menu clicked')}
        selectedDate={new Date()}
        showDatePicker={true}
      />
    </div>
  );
}

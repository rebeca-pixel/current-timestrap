import TaskForm from '../TaskForm';

export default function TaskFormExample() {
  return (
    <div className="bg-slate-950 min-h-screen p-6">
      <TaskForm 
        onSave={(task) => console.log('Task saved:', task)}
        onCancel={() => console.log('Cancelled')}
      />
    </div>
  );
}

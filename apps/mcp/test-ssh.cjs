// Script de test pour vérifier la connexion SSH
const { executeSSHCommand, getSSHConfig } = require("./dist/lib/sshClient.js");
require("dotenv").config();

async function testSSH() {
  try {
    console.log("🔍 Vérification de la configuration SSH...");
    const config = getSSHConfig();
    console.log("✅ Configuration SSH chargée:");
    console.log(`   Host: ${config.host}`);
    console.log(`   Username: ${config.username}`);
    console.log(`   Port: ${config.port}`);
    console.log(`   Password: ${config.password ? "***" : "MANQUANT"}`);
    
    console.log("\n🔌 Tentative de connexion SSH...");
    const result = await executeSSHCommand("echo 'SSH connection test successful'", config);
    
    console.log("✅ Connexion SSH réussie!");
    console.log("📤 Output:", result.stdout);
    
    console.log("\n🐳 Test de la commande Docker...");
    const dockerResult = await executeSSHCommand("docker ps --format '{{.Names}}' | head -5", config);
    console.log("✅ Docker accessible!");
    console.log("📤 Containers:", dockerResult.stdout || "(aucun conteneur en cours d'exécution)");
    
  } catch (error) {
    console.error("❌ Erreur:", error.message);
    
    if (error.message.includes("authentication")) {
      console.error("\n💡 Suggestions:");
      console.error("   - Vérifiez que le mot de passe SSH dans .env est correct");
      console.error("   - Vérifiez que l'utilisateur SSH est correct (par défaut: zimaos)");
      console.error("   - Testez la connexion manuellement: ssh zimaos@zimacube.local");
    } else if (error.message.includes("ECONNREFUSED") || error.message.includes("ENOTFOUND")) {
      console.error("\n💡 Suggestions:");
      console.error("   - Vérifiez que SSH est activé sur ZimaOS");
      console.error("   - Vérifiez que l'host est accessible depuis votre machine");
      console.error("   - Vérifiez le port SSH (par défaut: 22)");
    }
  }
}

testSSH();

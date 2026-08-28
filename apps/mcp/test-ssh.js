// Script de test pour vérifier la connexion SSH
import { executeSSHCommand, getSSHConfig } from "./dist/lib/sshClient.js";
import dotenv from "dotenv";

dotenv.config();

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
      console.error("   - Vérifiez que l'utilisateur SSH est correct (bobdivx ou zimaos)");
      console.error("   - Testez la connexion manuellement: ssh bobdivx@zimacube.local");
    } else if (error.message.includes("ECONNREFUSED") || error.message.includes("ENOTFOUND")) {
      console.error("\n💡 Suggestions:");
      console.error("   - Vérifiez que SSH est activé sur ZimaOS");
      console.error("   - Vérifiez que l'host est accessible depuis votre machine");
      console.error("   - Vérifiez le port SSH (par défaut: 22)");
    }
  }
}

testSSH();
